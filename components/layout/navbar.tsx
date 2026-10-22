import Link from "next/link";
import { Star } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/lib/site";

const navLinks = [
  { href: "#cara-kerja", label: "Cara Kerja" },
  { href: "#panduan", label: "Panduan" },
  { href: "#faq", label: "FAQ" },
] as const;

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <nav
        aria-label="Navigasi utama"
        className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Star className="size-4" aria-hidden="true" />
          </span>
          {siteConfig.shortName}
          <span className="hidden text-muted-foreground sm:inline">
            Generator
          </span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <ul className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <a
            href="#generator"
            className={cn(buttonVariants({ size: "sm" }), "px-3")}
          >
            Buat Link
          </a>
        </div>
      </nav>
    </header>
  );
}
