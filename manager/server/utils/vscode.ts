import { join } from "node:path";

export function vscodeUri(user: string, host: string, root: string, workspace?: string): string {
  const target = workspace ? join(root, workspace) : `${root.replace(/\/+$/, "")}/`;
  const encodedPath = target.split("/").map(encodeURIComponent).join("/");
  return `vscode://vscode-remote/ssh-remote+${encodeURIComponent(user)}@${encodeURIComponent(host)}${encodedPath}`;
}
