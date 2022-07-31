import { GenerateFlags, debugDumpFromNode, getToken, parse } from "./metadesk";

let str = `
@include("<frc/Joystick.h>")
io: {
	@class("frc::Joystick")
	Joystick: {
		@doc("""Construct an instance of a joystick.""")

		// We do our own thing for these that adds deadband and stuff.
		double GetTwist();
		@nolua double GetThrottle(); // we do our own implementation of this
	}
}
`;

str = `
foo: [hello goodbye, johnson]
bar: 1 2 3

baz:
4 5 6
`;

let tokenStr = str;
let token;
while (token = getToken(tokenStr)) {
    console.log(token);
    tokenStr = token.remaining;
}

console.log('------------------------');

const parsed = parse(str);
console.log(parsed);
console.log(debugDumpFromNode(parsed.node!, 0, "  ", GenerateFlags.Tree))
