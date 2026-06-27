"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP as useGsapReact } from "@gsap/react";
import { useRef, type RefObject } from "react";

gsap.registerPlugin(ScrollTrigger, useGsapReact);

interface UseScrollRevealOptions {
  threshold?: number;
  stagger?: number;
  y?: number;
  delay?: number;
}

export function useScrollReveal<T extends HTMLElement>(
  options: UseScrollRevealOptions = {}
) {
  const { threshold = 0.2, stagger = 0.1, y = 30, delay = 0 } = options;
  const ref = useRef<T>(null);

  useGsapReact(
    () => {
      if (!ref.current) return;
      const elements = ref.current.querySelectorAll("[data-reveal]");
      if (elements.length === 0) {
        gsap.fromTo(
          ref.current,
          { opacity: 0, y },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            delay,
            ease: "power3.out",
            scrollTrigger: {
              trigger: ref.current,
              start: `top ${100 - threshold * 100}%`,
              toggleActions: "play none none none",
            },
          }
        );
      } else {
        gsap.fromTo(
          elements,
          { opacity: 0, y },
          {
            opacity: 1,
            y: 0,
            duration: 0.6,
            stagger,
            delay,
            ease: "power3.out",
            scrollTrigger: {
              trigger: ref.current,
              start: `top ${100 - threshold * 100}%`,
              toggleActions: "play none none none",
            },
          }
        );
      }
    },
    { scope: ref }
  );

  return ref;
}

interface UseStaggerRevealOptions {
  stagger?: number;
  y?: number;
  scale?: number;
  duration?: number;
}

export function useStaggerReveal<T extends HTMLElement>(
  options: UseStaggerRevealOptions = {}
) {
  const { stagger = 0.08, y = 20, scale = 0.95, duration = 0.5 } = options;
  const ref = useRef<T>(null);

  useGsapReact(
    () => {
      if (!ref.current) return;
      const children = Array.from(ref.current.children);
      gsap.fromTo(
        children,
        { opacity: 0, y, scale },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration,
          stagger,
          ease: "power3.out",
        }
      );
    },
    { scope: ref }
  );

  return ref;
}

interface UseParallaxOptions {
  y?: number;
  ease?: string;
}

export function useParallax<T extends HTMLElement>(
  options: UseParallaxOptions = {}
) {
  const { y = -50, ease = "none" } = options;
  const ref = useRef<T>(null);

  useGsapReact(
    () => {
      if (!ref.current) return;
      gsap.to(ref.current, {
        y,
        ease,
        scrollTrigger: {
          trigger: ref.current,
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
        },
      });
    },
    { scope: ref }
  );

  return ref;
}

export function useHoverScale<T extends HTMLElement>(scale = 1.05) {
  const ref = useRef<T>(null);

  useGsapReact(
    () => {
      if (!ref.current) return;
      ref.current.addEventListener("mouseenter", () => {
        gsap.to(ref.current, { scale, duration: 0.3, ease: "power2.out" });
      });
      ref.current.addEventListener("mouseleave", () => {
        gsap.to(ref.current, { scale: 1, duration: 0.3, ease: "power2.out" });
      });
    },
    { scope: ref }
  );

  return ref;
}

export function useMagneticButton<T extends HTMLElement>(
  strength = 0.3
) {
  const ref = useRef<T>(null);

  useGsapReact(
    () => {
      if (!ref.current) return;

      const handleMove = (e: MouseEvent) => {
        const rect = ref.current!.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const deltaX = (e.clientX - centerX) * strength;
        const deltaY = (e.clientY - centerY) * strength;

        gsap.to(ref.current, {
          x: deltaX,
          y: deltaY,
          duration: 0.3,
          ease: "power2.out",
        });
      };

      const handleLeave = () => {
        gsap.to(ref.current, {
          x: 0,
          y: 0,
          duration: 0.5,
          ease: "elastic.out(1, 0.3)",
        });
      };

      ref.current!.addEventListener("mousemove", handleMove);
      ref.current!.addEventListener("mouseleave", handleLeave);

      return () => {
        ref.current?.removeEventListener("mousemove", handleMove);
        ref.current?.removeEventListener("mouseleave", handleLeave);
      };
    },
    { scope: ref }
  );

  return ref;
}

export function useTextReveal<T extends HTMLElement>(delay = 0) {
  const ref = useRef<T>(null);

  useGsapReact(
    () => {
      if (!ref.current) return;

      const words = ref.current.textContent?.split(" ") || [];
      ref.current.innerHTML = words
        .map(
          (word) =>
            `<span class="inline-block overflow-hidden"><span class="inline-block">${word}</span></span>`
        )
        .join(" ");

      const spans = ref.current.querySelectorAll("span > span");
      gsap.fromTo(
        spans,
        { y: "100%", opacity: 0 },
        {
          y: "0%",
          opacity: 1,
          duration: 0.6,
          stagger: 0.03,
          delay,
          ease: "power3.out",
        }
      );
    },
    { scope: ref }
  );

  return ref;
}

export function gsapFadeIn(
  targets: gsap.TweenTarget,
  options: gsap.TweenVars = {}
) {
  return gsap.fromTo(
    targets,
    { opacity: 0, ...options.from },
    {
      opacity: 1,
      duration: 0.6,
      ease: "power2.out",
      ...options.to,
    }
  );
}

export function gsapSlideUp(
  targets: gsap.TweenTarget,
  options: gsap.TweenVars = {}
) {
  return gsap.fromTo(
    targets,
    { opacity: 0, y: 30, ...options.from },
    {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: "power3.out",
      ...options.to,
    }
  );
}

export function gsapStaggerUp(
  targets: gsap.TweenTarget,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: { from?: Record<string, any>; to?: Record<string, any> } = {}
) {
  return gsap.fromTo(
    targets,
    { opacity: 0, y: 25, scale: 0.95, ...options.from },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.5,
      stagger: 0.08,
      ease: "power3.out",
      ...options.to,
    }
  );
}

// ============================================================
// Pixel-style animations (retro, blocky, grid-aligned)
// ============================================================

/** Stagger-in pool cards with a slight scale + pixel-blur feel */
export function gsapPixelStagger(
  targets: gsap.TweenTarget,
  options: { stagger?: number; delay?: number } = {}
) {
  const { stagger = 0.06, delay = 0 } = options;
  return gsap.fromTo(
    targets,
    { opacity: 0, y: 12, scale: 0.96 },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.35,
      stagger,
      delay,
      ease: "power1.out",
    }
  );
}

/** Price flash — brief color pulse on a value change */
export function gsapPriceFlash(target: gsap.TweenTarget, isUp: boolean) {
  const color = isUp ? "#00ff88" : "#ff4466";
  gsap.fromTo(
    target,
    { color },
    { color: "#d8d8ff", duration: 0.6, ease: "power1.out" }
  );
}

/** Retro entry — slide up from below with a slight overshoot */
export function gsapRetroEntry(
  targets: gsap.TweenTarget,
  options: { delay?: number; duration?: number; y?: number } = {}
) {
  const { delay = 0, duration = 0.4, y = -8 } = options;
  return gsap.fromTo(
    targets,
    { opacity: 0, y },
    {
      opacity: 1,
      y: 0,
      duration,
      delay,
      ease: "back.out(1.4)",
    }
  );
}

/** Glitch shake — for error / loading disruption */
export function gsapGlitch(target: gsap.TweenTarget) {
  const tl = gsap.timeline();
  tl.to(target, { x: -4, duration: 0.05, ease: "none" })
    .to(target, { x: 4, duration: 0.05, ease: "none" })
    .to(target, { x: -2, duration: 0.05, ease: "none" })
    .to(target, { x: 2, duration: 0.05, ease: "none" })
    .to(target, { x: 0, duration: 0.05, ease: "none" });
  return tl;
}

/** Pulse glow — for live / active indicators */
export function gsapPulseGlow(target: gsap.TweenTarget, color = "#00ff88") {
  return gsap.to(target, {
    opacity: 0.4,
    duration: 0.8,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });
}

/** Spin pixel — discrete rotation in 90deg steps */
export function gsapPixelSpin(target: gsap.TweenTarget) {
  return gsap.to(target, {
    rotation: "+=360",
    duration: 0.8,
    ease: "none",
  });
}

/** Chart bar grow — for volume or stat bars */
export function gsapBarGrow(
  targets: gsap.TweenTarget,
  fromValue = 0,
  toValue = 1
) {
  return gsap.fromTo(
    targets,
    { scaleY: fromValue, transformOrigin: "bottom center" },
    { scaleY: toValue, duration: 0.5, ease: "power1.out" }
  );
}

/** Scanline sweep — retro CRT scan effect */
export function gsapScanline(
  container: HTMLElement,
  duration = 2
) {
  const line = document.createElement("div");
  line.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%;
    height: 2px; background: rgba(136,136,255,0.15);
    pointer-events: none; z-index: 10;
  `;
  container.style.position = "relative";
  container.appendChild(line);
  gsap.to(line, {
    y: container.offsetHeight,
    duration,
    ease: "none",
    onComplete: () => line.remove(),
  });
}

export { gsap, ScrollTrigger };
