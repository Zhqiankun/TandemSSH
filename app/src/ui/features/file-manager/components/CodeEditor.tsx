import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { EditorState } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  loadLanguage,
  type LanguageName,
} from "@uiw/codemirror-extensions-langs";
import { EditorView, keymap } from "@codemirror/view";
import { searchKeymap, search, openSearchPanel } from "@codemirror/search";
import {
  defaultKeymap,
  history,
  historyKeymap,
  toggleComment,
} from "@codemirror/commands";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";

export interface CodeEditorHandle {
  openSearchPanel: () => void;
}

interface CodeEditorProps {
  fileName: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  fontSize?: number;
}

function getLanguageExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const baseName = filename.toLowerCase();

  if (["dockerfile", "makefile", "rakefile", "gemfile"].includes(baseName)) {
    return loadLanguage(baseName as LanguageName);
  }

  const langMap: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    php: "php",
    rb: "ruby",
    go: "go",
    rs: "rust",
    html: "html",
    css: "css",
    scss: "sass",
    less: "less",
    json: "json",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    vue: "vue",
    svelte: "svelte",
    md: "markdown",
    conf: "shell",
    ini: "properties",
  };

  const language = langMap[ext];
  return language ? loadLanguage(language as LanguageName) : null;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    { fileName, value, placeholder, onChange, onFocus, onBlur, fontSize = 14 },
    ref,
  ) {
    const { t } = useTranslation();
    const editorRef = useRef<{ view?: EditorView } | null>(null);

    const extensions = useMemo(() => {
      const languageExtension = getLanguageExtension(fileName);

      return [
        ...(languageExtension ? [languageExtension] : []),
        EditorState.phrases.of(
          Object.fromEntries(
            [
              ["Find", "find"],
              ["Replace", "replaceField"],
              ["next", "next"],
              ["previous", "previous"],
              ["all", "all"],
              ["match case", "matchCase"],
              ["regexp", "regexp"],
              ["by word", "wholeWord"],
              ["replace", "replace"],
              ["replace all", "replaceAll"],
              ["close", "close"],
              ["Go to line", "goToLine"],
              ["go", "go"],
              ["current match", "currentMatch"],
              ["on line", "onLine"],
              ["replaced match on line $", "replacedLine"],
              ["replaced $ matches", "replacedMatches"],
            ].map(([phrase, key]) => [
              phrase,
              t("fileManager.editorSearch." + key),
            ]),
          ),
        ),
        history(),
        search(),
        autocompletion(),
        keymap.of([
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          {
            key: "Mod-/",
            run: toggleComment,
            preventDefault: true,
          },
          {
            key: "Mod-h",
            run: openSearchPanel,
            preventDefault: true,
          },
        ]),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: `${fontSize}px`,
          },
          ".cm-scroller": {
            overflow: "auto",
            scrollbarWidth: "thin",
            scrollbarColor: "var(--scrollbar-thumb) var(--scrollbar-track)",
          },
          ".cm-editor": {
            height: "100%",
          },
        }),
      ];
    }, [fileName, fontSize, t]);

    useImperativeHandle(
      ref,
      () => ({
        openSearchPanel: () => {
          const view = editorRef.current?.view;
          if (view) {
            openSearchPanel(view);
          }
        },
      }),
      [],
    );

    return (
      <CodeMirror
        ref={editorRef}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        extensions={extensions}
        theme={oneDark}
        placeholder={placeholder}
        className="h-full"
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          highlightSelectionMatches: false,
        }}
      />
    );
  },
);
