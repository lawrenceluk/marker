"use client";

import EmojiPicker, { Theme } from "emoji-picker-react";

export default function NoteEmojiPicker({ height, onSelect }: {
  height: number;
  onSelect: (emoji: string) => void;
}) {
  return (
    <EmojiPicker
      theme={Theme.AUTO}
      width="100%"
      height={height}
      autoFocusSearch
      onEmojiClick={data => onSelect(data.emoji)}
    />
  );
}
