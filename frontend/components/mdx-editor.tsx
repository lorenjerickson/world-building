"use client";

import dynamic from "next/dynamic";
import { forwardRef } from "react";
import type { MDXEditorMethods, MDXEditorProps } from "@mdxeditor/editor";

const ClientEditor = dynamic(() => import("./mdx-editor-initialized"), { ssr: false, loading: () => <div className="mdx-editor-loading">Loading editor...</div> });

export const RichMarkdownEditor = forwardRef<MDXEditorMethods, MDXEditorProps>((props, ref) => <ClientEditor {...props} editorRef={ref} />);
RichMarkdownEditor.displayName = "RichMarkdownEditor";
