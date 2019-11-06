import { TypeChecker, TransformationContext, SourceFile } from "typescript";

export function getStripNamespacesTransformFactory(checker: TypeChecker) {
    return stripNamespaces;
    function stripNamespaces(context: TransformationContext) {
        return transformSourceFile;
        function transformSourceFile(file: SourceFile) {
            return file;
        }
    }
}