import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";

export function transformProjectAtPath(rootConfig: string, outDir: string) {
    const projDir = path.dirname(rootConfig);
    const host = ts.createSolutionBuilderHost(ts.sys);
    // we just want to (ab)use the builder API to traverse the project reference graph
    // and find all source files we need to transform, so we override the `createProgram`
    // hook to get a type checker and run our transform on each invocation
    const createProgram = host.createProgram;
    host.createProgram = (names, opts, host, oldProgram, configDiag, refs) => {
        const result = createProgram(names, opts, host, oldProgram, configDiag, refs);

        // Transform all actual input source files
        const candidateFiles = result.getSourceFiles().slice().filter(f =>
            !f.isDeclarationFile &&
            !f.fileName.endsWith(".json") &&
            !f.fileName.endsWith(".js") &&
            !f.fileName.endsWith(".jsx")
        );
        const checker = result.getProgram().getTypeChecker();
        const newSources = ts.transform(candidateFiles, [transformFactoryFactory(checker)]);
        const printer = ts.createPrinter({}, {
            onEmitNode: newSources.emitNodeWithNotification,
            substituteNode: newSources.substituteNode
        });
        for (const file of newSources.transformed) {
            const fullPath = path.resolve(file.fileName); // assumes file.fileName is absolute - in certain (?) scenarios this may not be the case
            const fragment = path.relative(path.resolve(projDir), fullPath);
            const newPath = path.join(path.resolve(outDir), fragment);
            try {
                fs.mkdirSync(path.dirname(newPath), { recursive: true });
            }
            catch {}
            fs.writeFileSync(newPath, printer.printFile(file));
        }

        return result;
    };
    

    const solution = ts.createSolutionBuilder(host, [rootConfig], {});
    solution.clean(); // we _do_ need to clean to get a good build, though
    solution.build();
    return;

    function transformFactoryFactory(checker: ts.TypeChecker) {
        return transformFactory;
        function transformFactory(context: ts.TransformationContext) {
            return transform;

            function transform(node: ts.SourceFile) {
                return node;
            }
        }
    }
}
