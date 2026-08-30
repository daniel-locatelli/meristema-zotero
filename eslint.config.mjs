import zotero from "@zotero-plugin/eslint-config";

/**
 * The graph's colours live in one file. Every other file in the drawing path
 * reads tokens from `graphTheme.ts`, so the canvas and `graph.css` can never
 * drift apart and a theme is a single edit rather than a hunt through three
 * renderers. This is the rule that keeps it that way.
 */
const COLOR_LITERAL = "/^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\\(.*)$/";

export default [
  ...zotero(),
  {
    files: [
      "src/services/citationGraphRenderer.ts",
      "src/services/graphRendererScene.ts",
      "src/services/graphCategoryAssignment.ts",
      "src/services/graphMetricScale.ts",
      "src/services/graphViewControls.ts",
      "src/services/graphKeyModel.ts",
      "src/services/graphKeyRail.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=${COLOR_LITERAL}]`,
          message:
            "Colours belong in graphTheme.ts. Read a token instead of writing a literal.",
        },
      ],
    },
  },
];
