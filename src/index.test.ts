import * as fs from "fs";
import * as path from "path";
import "./directorySnapshot";
import {transformProjectAtPath} from "./";

const fixturesDir = path.join(__dirname, "../test/fixtures");

describe("the project transform", () => {
    const directoryResult = fs.readdirSync(fixturesDir);
    for (const dir of directoryResult) {
        it(`with ${dir}`, () => {
            const baselineLocalDir = path.join(fixturesDir, dir, "baseline", "local");
            const baselineReferenceDir = path.join(fixturesDir, dir, "baseline", "reference");
            transformProjectAtPath(path.join(fixturesDir, dir, "input", "tsconfig.json"), baselineLocalDir);
            expect(baselineLocalDir).toMatchDirectorySnapshot(baselineReferenceDir);
        });
    }
});
