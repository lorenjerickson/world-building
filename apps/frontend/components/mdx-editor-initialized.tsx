"use client";

import type { ForwardedRef } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  DiffSourceToggleWrapper,
  ListsToggle,
  MDXEditor,
  Separator,
  UndoRedo,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
  type MDXEditorProps,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

export default function InitializedMDXEditor({ editorRef, ...props }: { editorRef: ForwardedRef<MDXEditorMethods> | null } & MDXEditorProps) {
  return <MDXEditor
    {...props}
    ref={editorRef}
    className={`dark-theme lore-mdx-editor ${props.className || ""}`}
    plugins={[
      headingsPlugin({ allowedHeadingLevels: [2, 3, 4] }),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      markdownShortcutPlugin(),
      diffSourcePlugin({ viewMode: "rich-text", diffMarkdown: props.markdown }),
      toolbarPlugin({ toolbarContents: () => <DiffSourceToggleWrapper options={["rich-text", "source"]}><UndoRedo /><Separator /><BlockTypeSelect /><BoldItalicUnderlineToggles /><ListsToggle /><CreateLink /></DiffSourceToggleWrapper> }),
    ]}
  />;
}
