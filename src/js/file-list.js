// file-list.js — Liste des fichiers du projet (partagé sidebar ↔ tabs)

let currentFiles = [];

export function getFileList() {
  return currentFiles;
}

/**
 * Reconstruit la liste des chemins relatifs à partir du treeData
 */
export function updateFileList(treeData, prefix = '') {
  const files = [];
  for (const node of treeData) {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.is_dir) {
      files.push(path + '/');
      if (node.children) {
        files.push(...updateFileList(node.children, path));
      }
    } else {
      files.push(path);
    }
  }
  currentFiles = files;
  return files;
}
