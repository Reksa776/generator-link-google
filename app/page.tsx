import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { ReviewLinkGenerator } from "@/components/generator/review-link-generator";
import { Faq } from "@/components/sections/faq";
import { Guide } from "@/components/sections/guide";
import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";

export default function Home() {
  return (
    <>
      <Navbar />

      <main className="flex-1">
        <Hero />

        <section
          aria-label="Generator link ulasan Google"
          className="border-b border-border"
        >
          <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-14">
            <ReviewLinkGenerator />
          </div>
        </section>

        <HowItWorks />
        <Guide />
        <Faq />
      </main>

      <Footer />
    </>
  );
}
