"use client";

import { useEffect, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { ToolbarTooltip } from "./ToolbarButton";

export function ScrollActions() {
  const [isAtTop, setIsAtTop] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;

      const atTop = scrollTop < 10;
      const atBottom = scrollHeight - scrollTop - clientHeight < 10;

      setIsAtTop(atTop);
      setIsAtBottom(atBottom);
      setIsVisible(!atTop || !atBottom);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToBottom() {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    });
  }

  return (
    <div
      className={`scroll-actions fixed bottom-6 right-6 z-50 flex flex-col gap-2 transition-opacity duration-300 ${
        isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      {!isAtTop && (
        <button
          onClick={scrollToTop}
          className="group relative grid size-12 cursor-pointer place-items-center rounded-full bg-background text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
          aria-label="Scroll to top"
        >
          <ChevronUp size={20} />
          <ToolbarTooltip label="Scroll to top" placement="above" />
        </button>
      )}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="group relative grid size-12 cursor-pointer place-items-center rounded-full bg-background text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={20} />
          <ToolbarTooltip label="Scroll to bottom" placement="above" />
        </button>
      )}
    </div>
  );
}
