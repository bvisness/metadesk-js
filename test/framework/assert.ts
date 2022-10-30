import { TestContext } from "./framework";

function str(v: any): string {
    return JSON.stringify(v);
}

export function assertEqual<T>(t: TestContext, actual: T, expected: T): boolean {
    if (actual !== expected) {
        t.fail(`Expected ${str(expected)} but got ${str(actual)}`);
        return false;
    }
    return true;
}

export function assertLength(t: TestContext, v: any[], length: number): boolean {
    if (v.length !== length) {
        t.fail(`Expected array of length ${length}, but got length ${v.length} instead`);
        return false;
    }
    return true;
}
