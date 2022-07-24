import { getToken, parse } from "./metadesk";

let str = `
@include("<frc/Joystick.h>")
io: {
	@enum
	XboxButton: {
		A: 1,
		B: 2,
	}

	@class("frc::Joystick")
	Joystick: {
		@doc("""Construct an instance of a joystick.""")

		// We do our own thing for these that adds deadband and stuff.
		double GetTwist();
		@nolua double GetThrottle(); // we do our own implementation of this that remaps the values the way we like
	}
}
`;

// let token;
// while (token = getToken(str)) {
//     console.log(token);
//     str = str.slice(token.rawString.length);
// }

console.log(parse(str));
