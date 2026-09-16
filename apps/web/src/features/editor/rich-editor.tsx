"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { RichNode } from "@resume/schema";
export function RichEditor({
  value,
  onChange,
}: {
  value: RichNode;
  onChange: (v: RichNode) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        underline: false,
        link: { openOnClick: false },
      }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getJSON() as RichNode),
    editorProps: {
      attributes: { "aria-label": "내용 편집", class: "rich-input" },
    },
  });
  return (
    <div className="rich-edit">
      <div className="rich-toolbar no-print">
        <button
          type="button"
          aria-label="굵게"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="기울임"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          목록
        </button>
        <button
          type="button"
          onClick={() => {
            const href = prompt("http/https 링크");
            if (href && /^https?:\/\//.test(href))
              editor?.chain().focus().setLink({ href }).run();
          }}
        >
          링크
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().unsetLink().run()}
        >
          링크 해제
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
