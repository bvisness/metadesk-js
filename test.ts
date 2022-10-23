import { GenerateFlags, debugDumpFromNode, getToken, parse } from "./metadesk";

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

let tokenStr = str;
let token;
while (token = getToken(tokenStr)) {
    console.log(token.toString());
    tokenStr = token.remaining;
}

console.log('------------------------');

const parsed = parse(str);
console.log(parsed);
console.log(debugDumpFromNode(parsed.node!, 0, "  ", GenerateFlags.Tree))
for (const err of parsed.fancyErrors()) {
	console.log(err);
}
