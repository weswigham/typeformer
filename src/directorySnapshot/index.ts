/// <reference types="jest" />

import { compareSync, Options } from "dir-compare";
import { matcherHint, EXPECTED_COLOR, RECEIVED_COLOR } from "jest-matcher-utils";
import * as path from "path";

export function toMatchDirectorySnapshot(this: jest.MatcherContext, outputDir: string, baselineDir: string) {
    if (this.isNot) {
        throw new Error("jest: Directory snapshots cannot be used with .not");
    }
    const name = "toMatchDirectorySnapshot";

    const options: Partial<Options> = { compareSize: true, compareContent: true };
    
    const res = compareSync(baselineDir, outputDir, options);
    if (res.same) {
        return {
            name,
            pass: true,
            message: () => '',
        };
    }

    const report = () =>
        `Input directory content ${RECEIVED_COLOR(`${outputDir}`)} does not match directory ${EXPECTED_COLOR(`${baselineDir}`)}.

${res.diffSet!
    .filter(d => d.state !== "equal")
    .map(d => d.state === "right" ? `${EXPECTED_COLOR("baseline")} ${d.type1} ${d.type2} ${path.join(d.relativePath, d.name2 || "")}`
        : d.state === "left" ? `${RECEIVED_COLOR("output")} ${d.type2} ${d.type1} ${path.join(d.relativePath, d.name1 || "")}`
        : `${RECEIVED_COLOR("output")} ${path.join(d.relativePath, d.name1 || "")} differs`)
    .join("\n")}`;

    return {
        name,
        pass: false,
        message: () => `${matcherHint(`.${name}`, `"${outputDir}"`, `"${baselineDir}"`)}\n\n${report()}`,
        report,
    };
}
expect.extend({toMatchDirectorySnapshot});

declare global {
    namespace jest {
        interface Matchers<R, T> {
            toMatchDirectorySnapshot(path: string): R;
        }
    }
}