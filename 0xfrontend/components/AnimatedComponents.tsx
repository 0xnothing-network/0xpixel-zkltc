"use client";

import { useRef, useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

interface AnimatedSectionProps {
  children: React.ReactNode;
  className?: string;
  stagger?: boolean;
  delay?: number;
  y?: number;
  threshold?: number;
}

export function AnimatedSection({
  children,
  className = "",
  stagger = false,
  delay = 0,
  y = 30,
  threshold = 0.8,
}: AnimatedSectionProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;

      const elements = stagger
        ? ref.current.children
        : [ref.current];

      gsap.fromTo(
        elements,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration: stagger ? 0.6 : 0.8,
          stagger: stagger ? 0.1 : 0,
          delay,
          ease: "power3.out",
          scrollTrigger:
            threshold < 1
              ? {
                  trigger: ref.current,
                  start: `top ${threshold * 100}%`,
                  toggleActions: "play none none none",
                }
              : undefined,
        }
      );
    },
    { scope: ref }
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

interface HeroTextProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export function HeroText({
  children,
  className = "",
  delay = 0,
}: HeroTextProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;

      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 40, scale: 0.98 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.9,
          delay,
          ease: "power3.out",
        }
      );
    },
    { scope: ref }
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

interface AnimatedCardProps {
  children: React.ReactNode;
  className?: string;
  index?: number;
  hoverable?: boolean;
}

export function AnimatedCard({
  children,
  className = "",
  index = 0,
  hoverable = true,
}: AnimatedCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;

      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 30, scale: 0.95 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.6,
          delay: index * 0.08,
          ease: "power3.out",
        }
      );
    },
    { scope: ref }
  );

  useEffect(() => {
    if (!ref.current || !hoverable) return;

    const el = ref.current;

    const handleMouseEnter = () => {
      gsap.to(el, {
        y: -8,
        scale: 1.02,
        duration: 0.4,
        ease: "power2.out",
      });
    };

    const handleMouseLeave = () => {
      gsap.to(el, {
        y: 0,
        scale: 1,
        duration: 0.4,
        ease: "power2.out",
      });
    };

    el.addEventListener("mouseenter", handleMouseEnter);
    el.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      el.removeEventListener("mouseenter", handleMouseEnter);
      el.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [hoverable]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

interface ParallaxBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  y?: number;
}

export function ParallaxBackground({
  children,
  className = "",
  y = -30,
}: ParallaxBackgroundProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;

      gsap.to(ref.current, {
        y,
        ease: "none",
        scrollTrigger: {
          trigger: ref.current,
          start: "top bottom",
          end: "bottom top",
          scrub: 1.5,
        },
      });
    },
    { scope: ref }
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

interface GradientOrbProps {
  className?: string;
  color?: string;
  size?: string;
  blur?: string;
}

export function GradientOrb({
  className = "",
  color = "rgba(99, 102, 241, 0.15)",
  size = "50%",
  blur = "100px",
}: GradientOrbProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;

      gsap.fromTo(
        ref.current,
        { scale: 0.8, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 1.2,
          ease: "power2.out",
        }
      );

      gsap.to(ref.current, {
        y: "random(-20, 20)",
        x: "random(-20, 20)",
        duration: "random(8, 12)",
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
    },
    { scope: ref }
  );

  return (
    <div
      ref={ref}
      className={className}
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        filter: `blur(${blur})`,
        pointerEvents: "none",
      }}
    />
  );
}
