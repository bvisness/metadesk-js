import { GenerateFlags, debugDumpFromNode, getToken, parse, Token, TokenKind, Node, tokenize, NodeFlags, nodeFlagNames } from "../src/metadesk";
import { run, test, assertEqual, assertLength, TestContext } from "./framework";

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

// str = `
// foo = 2 - 1pizza3
// bar = -2
// baz = - 2
// blemmo = 2-3
// `

function parseSingleNode(src: string): Node {
	const res = parse(src);
	if (res.errors.length > 0) {
		throw new Error(
			`There were ${res.errors.length} errors during parsing:\n`
			+ res.errors.map(err => "  " + err.toString()).join("\n") + "\n"
      // + "Tokens:\n"
      // + tokenize(src).map(t => "  " + t.toString()).join("\n"),
		);
	}
	return res.node.children[0];
}

function assertChildren(t: TestContext, node: Node, strs: string[]): boolean {
  if (!assertLength(t, node.children, strs.length)) {
    return false;
  }

  let good = true;
  for (const [i, child] of node.children.entries()) {
    if (!assertEqual(t, child.string, strs[i])) {
      good = false;
    }
  }

  return good;
}

function assertNodeFlags(t: TestContext, n: Node, mask: NodeFlags, flags: NodeFlags): boolean {
  const flagsToCheck: NodeFlags[] = [];
  for (const flagName of nodeFlagNames) {
    if (mask & NodeFlags[flagName]) {
      flagsToCheck.push(NodeFlags[flagName]);
    }
  }

  let good = true;
  for (const flag of flagsToCheck) {
    if (flag & flags) {
      // check if node has flag
      if (!(n.flags & flag)) {
        t.fail(`Expected node to have flag ${NodeFlags[flag]}`);
        good = false;
      }
    } else {
      // check if node does _not_ have flag
      if (n.flags & flag) {
        t.fail(`Expected node not to have flag ${NodeFlags[flag]}`);
        good = false;
      }
    }
  }

  return good;
}

test("Lexer", t => {
	const tokens = tokenize("abc def 123 456 123_456 abc123 123abc +-*");

	function tokenMatch(tok: Token, str: string, kind: TokenKind) {
		const good = tok.kind == kind && tok.string == str;
		if (!good) {
			t.fail(`Expected token with kind ${TokenKind[kind]} and string "${str}", got ${tok.toString()}`);
		}
	}

	tokenMatch(tokens[0], "abc", TokenKind.Identifier);
	tokenMatch(tokens[1], " ", TokenKind.Whitespace);
	tokenMatch(tokens[2], "def", TokenKind.Identifier);
	tokenMatch(tokens[3], " ", TokenKind.Whitespace);
	tokenMatch(tokens[4], "123", TokenKind.Numeric);
	tokenMatch(tokens[5], " ", TokenKind.Whitespace);
	tokenMatch(tokens[6], "456", TokenKind.Numeric);
	tokenMatch(tokens[7], " ", TokenKind.Whitespace);
	tokenMatch(tokens[8], "123_456", TokenKind.Numeric);
	tokenMatch(tokens[9], " ", TokenKind.Whitespace);
	tokenMatch(tokens[10], "abc123", TokenKind.Identifier);
	tokenMatch(tokens[11], " ", TokenKind.Whitespace);
	tokenMatch(tokens[12], "123abc", TokenKind.Numeric);
	tokenMatch(tokens[13], " ", TokenKind.Whitespace);
	tokenMatch(tokens[14], "+-*", TokenKind.Symbol);
});

test("Empty Sets", t => {
	function assertEmpty(n: Node) {
		assertEqual(t, n.string, "");
		assertLength(t, n.children, 0);
	}

	assertEmpty(parseSingleNode("{}"));
	assertEmpty(parseSingleNode("()"));
	assertEmpty(parseSingleNode("[]"));
	assertEmpty(parseSingleNode("[)"));
	assertEmpty(parseSingleNode("(]"));
});

test("Simple Unnamed Sets", t => {
	const node = parseSingleNode("{a, b, c}");
  assertChildren(t, node, ["a", "b", "c"]);
});

test("Nested Sets", t => {
  t.test("Simple", t => {
    const node = parseSingleNode("{a b:{1 2 3} c}");
    if (assertChildren(t, node, ["a", "b", "c"])) {
      const b =  node.children[1];
      assertChildren(t, b, ["1", "2", "3"]);
    }
  });
  t.test("Code-like", t => {
    const node = parseSingleNode("foo: { (size: u64) -> *void }");
    assertEqual(t, node.string, "foo");
    if (assertChildren(t, node, ["", "->", "*", "void"])) {
      const params = node.children[0];
      if (assertChildren(t, params, ["size"])) {
        assertChildren(t, params.children[0], ["u64"]);
      }
    }
  });
});

test("Non-Sets", t => {
  {
    const node = parseSingleNode("foo");
    assertEqual(t, node.string, "foo");
    assertChildren(t, node, []);
  }
  {
    const node = parseSingleNode("123");
    assertEqual(t, node.string, "123");
    assertChildren(t, node, []);
  }
  {
    const node = parseSingleNode("+");
    assertEqual(t, node.string, "+");
    assertChildren(t, node, []);
  }
});

test("Set Border Flags", t => {
  t.test("()", t => {
    const node = parseSingleNode("(0, 100)");
    assertNodeFlags(t, node, NodeFlags.MaskSetDelimiters, NodeFlags.HasParenLeft|NodeFlags.HasParenRight);
  });
  t.test("(]", t => {
    const node = parseSingleNode("(0, 100]");
    assertNodeFlags(t, node, NodeFlags.MaskSetDelimiters, NodeFlags.HasParenLeft|NodeFlags.HasBracketRight);
  });
  t.test("[)", t => {
    const node = parseSingleNode("[0, 100)");
    assertNodeFlags(t, node, NodeFlags.MaskSetDelimiters, NodeFlags.HasBracketLeft|NodeFlags.HasParenRight);
  });
  t.test("[]", t => {
    const node = parseSingleNode("[0, 100]");
    assertNodeFlags(t, node, NodeFlags.MaskSetDelimiters, NodeFlags.HasBracketLeft|NodeFlags.HasBracketRight);
  });
  t.test("{}", t => {
    const node = parseSingleNode("{0, 100}");
    assertNodeFlags(t, node, NodeFlags.MaskSetDelimiters, NodeFlags.HasBraceLeft|NodeFlags.HasBraceRight);
  });
});

test("Node Separator Flags", t => {
  const node = parseSingleNode("(a b, c; d)");
  if (assertChildren(t, node, ["a", "b", "c", "d"])) {
    assertNodeFlags(t, node.children[0], NodeFlags.MaskSeparators, NodeFlags.None);
    assertNodeFlags(t, node.children[1], NodeFlags.MaskSeparators, NodeFlags.IsBeforeComma);
    assertNodeFlags(t, node.children[2], NodeFlags.MaskSeparators, NodeFlags.IsAfterComma|NodeFlags.IsBeforeSemicolon);
    assertNodeFlags(t, node.children[3], NodeFlags.MaskSeparators, NodeFlags.IsAfterSemicolon);
  }
});

test("Node Text Flags", t => {
  t.test("Numeric", t => {
    t.test("123", t => {
      const node = parseSingleNode("123");
      assertNodeFlags(t, node, NodeFlags.MaskLabelKind, NodeFlags.Numeric);
    });
    t.test("123_456_789", t => {
      const node = parseSingleNode("123_456_789");
      assertNodeFlags(t, node, NodeFlags.MaskLabelKind, NodeFlags.Numeric);
    });
  });

  t.test("Identifier", t => {
    t.test("abc", t => {
      const node = parseSingleNode("abc");
      assertNodeFlags(t, node, NodeFlags.MaskLabelKind, NodeFlags.Identifier);
    });
  });

  t.test("Strings", t => {
    const cases = [
      ["\"foo\"", NodeFlags.StringDoubleQuote],
      ["'foo'", NodeFlags.StringSingleQuote],
      ["`foo`", NodeFlags.StringTick],
      ["\"\"\"foo\"\"\"", NodeFlags.StringDoubleQuote|NodeFlags.StringTriplet],
      ["'''foo'''", NodeFlags.StringSingleQuote|NodeFlags.StringTriplet],
      ["```foo```", NodeFlags.StringTick|NodeFlags.StringTriplet],
    ] as const;
    for (const [str, flags] of cases) {
      t.test(str, t => {
        const node = parseSingleNode(str);
        assertNodeFlags(t, node, NodeFlags.MaskLabelKind, NodeFlags.StringLiteral);
        assertNodeFlags(t, node, NodeFlags.MaskStringDelimiters, flags);
      });
    }
  });
});

run();
