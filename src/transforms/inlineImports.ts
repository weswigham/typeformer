import { TypeChecker, TransformationContext, SourceFile } from "typescript";

export function getInlineImportsTransformFactory(checker: TypeChecker) {
    return inlineImports;
    function inlineImports(context: TransformationContext) {
        return transformSourceFile;
        function transformSourceFile(file: SourceFile) {
            return file;
        }
    }
}