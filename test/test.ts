import { GenerateFlags, debugDumpFromNode, getToken, parse } from "../src/metadesk";

let str = `
@include("<frc/Joystick.h>")
io: {
	@class("frc::Joystick")
	Joystick: {
		@doc("""Construct an instance of a joystick.""")
		@constructor new(int port);

		// We do our own thing for these that adds deadband and stuff.
		double GetTwist();
		@nolua double GetThrottle(); // we do our own implementation of this

		// hey i feel like if you're reading this you should know, WPI officially supports a guitar controller

		// GenericHID
		@alias(GetButtonHeld) bool GetRawButton(@enum(XboxButton) int button);
		@nolua double GetRawAxis(int axis); // we will write a custom getAxis with deadband
		int GetPOV(@default(0) int port); // Note that this takes an optional argument in case you somehow have more than one POV. I'm leaving that argument out.
		int GetAxisCount();

		// SetRumble(@cast("frc::GenericHID::RumbleType") int type, double value);
	}
}
`;

// str = `
// foo: hello goodbye, johnson
// bar: 1 2 3, he said

// @one @two(beep boop)
// @three
// baz:
// 4 5 6
// `;

// str = `
// "named but empty": ()
// "anonymous and empty" ()
// "empty but also whitespace": (   	
//   )
// `

// str = `
// // The general principle of comments is that you should get exactly the same parse results if you
// // replace them all with spaces before parsing. Despite this, we actually want to track the
// // comments before/after nodes for user convenience. So we need them to appear in the grammar in a
// // way that is reasonably easy to work with.
// foo: // shouldn't matter
// foo1 /* should be fine */ foo2 foo3 // zat is how it to be
// notfoo

// bar:
// bar1 bar2 bar3
// notbar
// `

str = `
foo = 2 - 1pizza3
bar = -2
baz = - 2
blemmo = 2-3
`

let tokenStr = str;
let token;
while (token = getToken(tokenStr)) {
    console.log(token.toString());
    tokenStr = token.remaining;
}

console.log('------------------------');

const parsed = parse(str);
console.log(debugDumpFromNode(parsed.node!, 0, "  ", GenerateFlags.Tree))
for (const err of parsed.fancyErrors()) {
	console.log(err);
}
