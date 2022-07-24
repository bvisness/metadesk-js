type NodeKind = "file"; // TODO

interface Node {
    kind: NodeKind,
    string: string,
    rawString: string,
    // TODO: offset,

    next: Node | undefined,
    prev: Node | undefined,
    parent: Node | undefined,

    children: Node[],
    tags: Node[],
}

function makeNode(kind: NodeKind, str: string, rawStr: string): Node {
    return {
        kind: kind,
        string: str,
        rawString: rawStr,

        next: undefined,
        prev: undefined,
        parent: undefined,

        children: [],
        tags: [],
    };
}

interface ParseResult {
    node: Node | undefined,
    errors: string[],
}

export function parse(source: string): ParseResult {
    const root = makeNode("file", "", source);
    const result = parseNodeSet(str)
}

enum TokenKind {
    Invalid = 0,

    Identifier      = 1 << 0,
    Numeric         = 1 << 1,
    StringLiteral   = 1 << 2,
    Symbol          = 1 << 3,
    Reserved        = 1 << 4,
    Comment         = 1 << 5,
    Whitespace      = 1 << 6,
    Newline         = 1 << 7,

    BrokenComment       = 1 << 8,
    BrokenStringLiteral = 1 << 9,
    BadCharacter        = 1 << 10,
}

enum TokenGroup {
    Comment     = TokenKind.Comment,
    Whitespace  = TokenKind.Whitespace | TokenKind.Newline,
    Irregular   = TokenKind.Comment | TokenKind.Whitespace,
    Regular     = ~Irregular,
    Label       = TokenKind.Identifier
                    | TokenKind.Numeric
                    | TokenKind.StringLiteral
                    | TokenKind.Symbol,
    Error       = TokenKind.BrokenComment
                    | TokenKind.BrokenStringLiteral
                    | TokenKind.BadCharacter,
}

enum NodeFlags {
    None = 0,

    HasParenLeft    = 1 << 0,
    HasParenRight   = 1 << 1,
    HasBracketLeft  = 1 << 2,
    HasBracketRight = 1 << 3,
    HasBraceLeft    = 1 << 4,
    HasBraceRight   = 1 << 5,

    MaskSetDelimiters = 0x3F << 0,

    IsBeforeSemicolon   = 1 << 6,
    IsAfterSemicolon    = 1 << 7,
    IsBeforeComma       = 1 << 8,
    IsAfterComma        = 1 << 9,

    MaskSeparators = 0xF << 6,

    StringSingleQuote   = 1 << 10,
    StringDoubleQuote   = 1 << 11,
    StringTick          = 1 << 12,
    StringTriplet       = 1 << 13,
    
    MaskStringDelimiters = 0xF << 10,
    
    Numeric         = 1 << 14,
    Identifier      = 1 << 15,
    StringLiteral   = 1 << 16,
    Symbol          = 1 << 17,
    
    MaskLabelKind = 0xF << 14,
}

interface Token {
    kind: TokenKind,
    // TODO: flags?
    string: string,
    rawString: string,
}

export function getToken(string: string): Token | undefined {
    if (string === "") {
        return undefined;
    }

    let kind = TokenKind.Invalid, flags = NodeFlags.None;
    let len = 0;
    let skip = 0, chop = 0;

    // Scan forward, updating len, until the condition is false.
    // string[len] will be at the first non-matching char.
    function scan(charMatches: (char: string) => boolean) {
        for (; len < string.length; len++) {
            if (!charMatches(string[len])) {
                break;
            }
        }
    }

    switch (string[0]) {
        // Whitespace parsing
        case "\n": {
            kind = TokenKind.Newline;
            len += 1;
        } break;
        case " ": case "\r": case "\t": case "\f": case "\v": {
            kind = TokenKind.Whitespace;
            len += 1;
            scan(c => [" ", "\r", "\t", "\f", "\v"].includes(c));
        } break;

        // Comment parsing
        case "/": {
            if (string.length <= 1) {
                // TODO: goto symbol_lex ???!!!?
                break;
            }

            if (string[1] === "/") {
                // Trim off the first "//"
                skip = 2;
                len += 2;
                kind = TokenKind.Comment;
                scan(c => !["\n", "\r"].includes(c));
            } else if (string[1] == "*") {
                // Trim off the first "/*"
                skip = 2;
                len += 2;
                kind = TokenKind.BrokenComment;
                let commentDepth = 1;
                for (; len < string.length && commentDepth > 0; len += 1) {
                    if (len + 1 < string.length) {
                        if (string[len] === "*" && string[len+1] === "/") {
                            len += 1;
                            commentDepth -= 1;
                        } else if (string[len] === "/" && string[len+1] === "*") {
                            len += 1;
                            commentDepth += 1;
                        }
                    }
                }
                if (commentDepth === 0) {
                    kind = TokenKind.Comment;
                    chop = 2;
                }
            }
        } break;

        // Strings
        case "\"": case "'": case "`": {
            kind = TokenKind.BrokenStringLiteral;

            // Determine delimiter setup (which delimiter, is it a triplet)
            const delim = string[0];
            const isTriplet = string.length >= 3 && string[1] === delim && string[2] === delim;

            if (isTriplet) {
                // Lex a triple-delimited string
                skip = 3;
                len += 3;
                let consecutiveDelims = 0;
                for (; len < string.length; len++) {
                    if (string[len] === delim) {
                        consecutiveDelims += 1;
                        if (consecutiveDelims === 3) {
                            chop = 3;
                            kind = TokenKind.StringLiteral;
                            break;
                        }
                    } else {
                        consecutiveDelims = 0;

                        // escaping characters in string literals
                        // (it seems that only the current delimiter can be escaped?)
                        if (string[len] === "\\" && (string[len+1] === delim || string[len+1] === "\\")) {
                            len += 1; // extra bump to skip the char after the backslash
                        }
                    }
                }
            } else {
                // Lex a single-delimited string
                skip = 1;
                len += 1;
                for (; len < string.length; len++) {
                    // Close condition
                    if (string[len] === delim) {
                        chop = 1;
                        len += 1;
                        kind = TokenKind.StringLiteral;
                        break;
                    }

                    // Fail condition
                    if (string[len] === "\n") {
                        break;
                    }

                    // escaping characters in string literals
                    // (it seems that only the current delimiter can be escaped?)
                    if (string[len] === "\\" && (string[len+1] === delim || string[len+1] === "\\")) {
                        len += 1; // extra bump to skip the char after the backslash
                    }
                }
            }

            flags |= NodeFlags.StringLiteral;
            switch (delim) {
                case "'":  flags |= NodeFlags.StringSingleQuote; break;
                case "\"": flags |= NodeFlags.StringDoubleQuote; break;
                case "`":  flags |= NodeFlags.StringTick; break;
            }
            if (isTriplet) {
                flags |= NodeFlags.StringTriplet;
            }
        } break;

        // Identifiers, numbers, symbols
        default: {
            const identifierMatch = string.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
            const numericMatch = string.match(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/);

            if (identifierMatch) {
                flags |= NodeFlags.Identifier;
                kind = TokenKind.Identifier;
                len += identifierMatch[0].length;
            } else if (numericMatch) {
                flags |= NodeFlags.Numeric;
                kind = TokenKind.Numeric;
                len += numericMatch[0].length;
            } else if (charIsUnreservedSymbol(string[0])) {
                flags |= NodeFlags.Symbol;
                kind = TokenKind.Symbol;
                len += 1;
                scan(c => charIsUnreservedSymbol(c));
            } else if (charIsReservedSymbol(string[0])) {
                kind = TokenKind.Reserved;
                len += 1;
            } else {
                kind = TokenKind.BadCharacter;
                len += 1;
            }
        } break;
    }

    return {
        kind: kind,
        rawString: string.slice(0, len),
        string: string.slice(skip, len-chop),
    }
}

function charIsUnreservedSymbol(c: string): boolean {
    return "~!$%^&*-=+<.>/?|".includes(c);
}

function charIsReservedSymbol(c: string): boolean {
    return "{}()\\[]#,;:@".includes(c);
}

function parseNodeSet(str: string, offset: number, parent: Node) {

}

// [newline] unscoped-children-list ,|;|newline
function parseUnscopedChildren() {

}
