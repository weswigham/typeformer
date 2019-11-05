import * as ts from "typescript/lib/tsserverlibrary";

function nowString() {
    // E.g. "12:34:56.789"
    const d = new Date();
    return `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}.${d.getMilliseconds()}`;
}

export class Logger implements ts.server.Logger {
    private seq = 0;
    private inGroup = false;
    private firstInGroup = true;

    constructor() {}

    static padStringRight(str: string, padding: string) {
        return (str + padding).slice(0, padding.length);
    }
    close() {}
    getLogFileName() {
        return "none";
    }
    perftrc(s: string) {
        this.msg(s, ts.server.Msg.Perf);
    }
    info(s: string) {
        this.msg(s, ts.server.Msg.Info);
    }
    err(s: string) {
        this.msg(s, ts.server.Msg.Err);
    }
    startGroup() {
        this.inGroup = true;
        this.firstInGroup = true;
    }
    endGroup() {
        this.inGroup = false;
    }
    loggingEnabled() {
        return false;
    }
    hasLevel() {
        return this.loggingEnabled();
    }
    msg(s: string, type: ts.server.Msg = ts.server.Msg.Err) {
        s = `[${nowString()}] ${s}\n`;
        if (!this.inGroup || this.firstInGroup) {
            const prefix = Logger.padStringRight(type + " " + this.seq.toString(), "          ");
            s = prefix + s;
        }
        console.log(s);
        if (!this.inGroup) {
            this.seq++;
        }
    }
}