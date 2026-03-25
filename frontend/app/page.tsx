import Navbar from "@/components/landing/navbar";
import HeroSection from "@/components/landing/hero-section";
import FeaturesSection from "@/components/landing/features-section";
import HowItWorksSection from "@/components/landing/how-it-works";
import UseCasesSection from "@/components/landing/use-cases";
import TrustSection from "@/components/landing/trust-section";
import FaqSection from "@/components/landing/faq-section";
import Footer from "@/components/landing/footer";

export default function HomePage() {
  return (
    <main className="overflow-x-hidden">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <UseCasesSection />
      <TrustSection />
      <FaqSection />
      <Footer />
    </main>
  );
}
