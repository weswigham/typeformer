import * as path from "path";
export function getTSStyleRelativePath(from: string, to: string) {
    let result = path.normalize(path.relative(path.dirname(from), to));
    if (!result.startsWith(".")) {
        result = `./${result}`;
    }
    return result.replace(/\\/g, "/");
}