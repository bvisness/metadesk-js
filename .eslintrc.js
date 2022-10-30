module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ["./tsconfig.json", "test/tsconfig.json"],
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:@typescript-eslint/strict",
  ],
  rules: {
    "quotes": ["error", "double"],
    "no-irregular-whitespace": "off",

    // wtf, guys
    "no-constant-condition": "off",
    "@typescript-eslint/no-unnecessary-condition": ["warn", { "allowConstantLoopConditions": true }],

    "@typescript-eslint/prefer-literal-enum-member": "off",
    "@typescript-eslint/no-unused-vars": ["warn", {
      "varsIgnorePattern": "^_",
      "argsIgnorePattern": "^_",
    }],

    "semi": "off",
    "@typescript-eslint/semi": "error",

    "@typescript-eslint/member-delimiter-style": "error",

    "@typescript-eslint/no-explicit-any": "off", // who do these morons think they are
  },
};
