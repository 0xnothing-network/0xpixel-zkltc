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
  options: gsap.TweenVars = {}
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

export { gsap, ScrollTrigger };
