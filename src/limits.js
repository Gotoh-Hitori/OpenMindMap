export const MAX_NODES = 1000;
export const MAX_EDGES = 5000;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_LENGTH = 2 * 1024 * 1024;
export function checkImportSize(input) {
  if (Array.isArray(input?.nodes) && input.nodes.length > MAX_NODES)
    throw Error('一次最多导入 1000 个节点');
  if (Array.isArray(input?.edges) && input.edges.length > MAX_EDGES)
    throw Error('一次最多导入 5000 条连接');
}
