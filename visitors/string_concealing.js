const t = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const vm = require('vm');

function findDecoderArrayId(AST) {
  var candidates = {};

  traverse(AST, {
    BlockStatement(path) {
      for (var node of path.node.body) {
        if (node?.expression?.callee?.property?.name !== "push") continue;
        if (node.expression?.arguments?.length !== 1) continue;
        if (!node.expression?.callee?.object?.name) continue;
        if (!t.isNumericLiteral(node.expression.arguments[0])) {
          if (candidates[node.expression.callee.object.name])
            delete candidates[node.expression.callee.object.name];
          continue;
        }

        if (candidates[node.expression.callee.object.name])
          candidates[node.expression.callee.object.name]++;
        else candidates[node.expression.callee.object.name] = 1;
      }
    },
  });

  const count = Math.max(...Object.values(candidates));
  return Object.keys(candidates).find((key) => candidates[key] == count);
}


function removeStringConcealing(AST_original, ctx, decoder_object, decoder_arr_id) {

    const AST = parser.parse(generate(AST_original).code)

    // visitor contains script breaking modifications that's why they are applied to a copy
    // of the "real" AST. It's only purpose is to execute every decoder function once aware
    // of it's scope as every function only decodes on first call, then saves the decoded value
    // and every consecutive call just returns that value. Therefore, if we "prepare" all decoders
    // on the copy we can later just call them on our original AST without modifying crucial things.
    const visitor = {
        BlockStatement(path) {
            var valid = false
            for (var node of path.node.body) {
                if (node?.expression?.callee?.object?.name !== decoder_arr_id) continue
                if (node?.expression?.callee?.property?.name !== 'push') continue
                valid = true
                vm.runInContext(generate(node).code, ctx)
            }
            if (!valid) return
            const occurences = path.toString().split(decoder_arr_id + '.push').length - 1
            if (occurences !== 1) return
            path.traverse({
                CallExpression(path) {
                    const {node, scope} = path
                    const id = node.callee.name || node.callee.object?.name || node.callee.object?.object?.name
                    if (path.parentPath.type === 'AssignmentExpression' && path.parentPath.node.left.name === decoder_arr_id) {
                        path.parentPath.remove()
                    }
                    if (!id) return
                    if (id !== decoder_arr_id && id !== decoder_object) return
                    if (id === decoder_object && node.arguments.length < 2) return
                    if (id === decoder_object) {
                        path.replaceWith(t.valueToNode(vm.runInContext(path.toString(), ctx)))
                        edits++
                    } else if (node.callee.object.name === decoder_arr_id) {
                        path.remove()
                    }
                }
            })
        }
    }
    var edits
    do {
        edits = 0
        traverse(AST, visitor)
    } while (edits !== 0)

    traverse(AST_original, {
        CallExpression(path) {
            if (!path.toString().startsWith(decoder_object)) return
            try {
                path.replaceWith(t.valueToNode(vm.runInContext(path.toString(), ctx)))
            } catch(e) {}
        }
    })

}



module.exports = { findDecoderArrayId, removeStringConcealing }
