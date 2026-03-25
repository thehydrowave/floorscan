import type { Metadata } from "next";
import Navbar from "@/components/landing/navbar";
import Footer from "@/components/landing/footer";

export const metadata: Metadata = {
  title: "Conditions Générales d'Utilisation — FloorScan",
  description: "Conditions générales d'utilisation du service FloorScan, plateforme d'analyse de plans par IA.",
};

export default function CguPage() {
  return (
    <main className="overflow-x-hidden bg-[#080c18] min-h-screen">
      <Navbar />
      <div className="max-w-3xl mx-auto px-6 pt-32 pb-24">
        <h1 className="font-display text-3xl md:text-4xl font-800 text-white mb-2">Conditions Générales d&apos;Utilisation</h1>
        <p className="text-slate-500 text-sm mb-12">Dernière mise à jour : janvier 2025</p>

        <div className="space-y-10 text-slate-300 text-sm leading-relaxed">

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 1 — Objet</h2>
            <p>
              Les présentes Conditions Générales d&apos;Utilisation (CGU) régissent l&apos;accès et l&apos;utilisation de la plateforme <strong className="text-white">FloorScan</strong> (ci-après « le Service »), accessible à l&apos;adresse <strong className="text-white">floorscan.ai</strong>, éditée par FloorScan SAS.
            </p>
            <p className="mt-3">
              L&apos;utilisation du Service implique l&apos;acceptation pleine et entière des présentes CGU. Si vous n&apos;acceptez pas ces conditions, veuillez ne pas utiliser le Service.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 2 — Description du Service</h2>
            <p>
              FloorScan est une plateforme SaaS d&apos;analyse de plans architecturaux par intelligence artificielle. Le Service permet notamment :
            </p>
            <ul className="mt-3 space-y-1.5 text-slate-400 list-none">
              {[
                "L'analyse automatique de plans de sol (PDF ou image) par IA",
                "La détection et le comptage des ouvertures (portes, fenêtres)",
                "Le calcul de surfaces, périmètres et métrés",
                "La génération de rapports professionnels (PDF)",
                "La création de documents BTP (DPGF, devis, CCTP)",
                "Le suivi de chantier et de l'avancement des travaux",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-brand-500 mt-0.5 shrink-0">→</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 3 — Accès et inscription</h2>
            <p>
              L&apos;accès au Service complet nécessite la création d&apos;un compte utilisateur. L&apos;utilisateur s&apos;engage à fournir des informations exactes lors de l&apos;inscription et à maintenir la confidentialité de ses identifiants.
            </p>
            <p className="mt-3">
              FloorScan SAS se réserve le droit de suspendre ou supprimer tout compte en cas d&apos;utilisation frauduleuse, abusive ou contraire aux présentes CGU.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 4 — Utilisation des données uploadées</h2>
            <p>
              L&apos;utilisateur est seul responsable des fichiers (plans, images) qu&apos;il soumet au Service. En uploadant un fichier, l&apos;utilisateur garantit :
            </p>
            <ul className="mt-3 space-y-1.5 text-slate-400">
              {[
                "Détenir les droits nécessaires sur le fichier (propriétaire, mandataire ou ayant droit)",
                "Ne pas soumettre de documents soumis à un secret professionnel sans autorisation",
                "Ne pas utiliser le Service à des fins illicites",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-brand-500 mt-0.5 shrink-0">→</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-3">
              Les fichiers uploadés sont traités en mémoire vive uniquement, avec une durée de vie maximum de 1 heure. FloorScan SAS ne conserve pas, ne vend pas et n&apos;utilise pas les plans à des fins d&apos;entraînement de modèles d&apos;IA sans consentement explicite.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 5 — Résultats de l&apos;analyse IA</h2>
            <p>
              Les analyses produites par FloorScan sont générées par des algorithmes d&apos;intelligence artificielle et ont une valeur indicative. Elles ne constituent pas un document technique certifié et ne sauraient remplacer l&apos;expertise d&apos;un professionnel qualifié (architecte, géomètre-expert, métreur).
            </p>
            <p className="mt-3">
              FloorScan SAS décline toute responsabilité pour les décisions prises sur la seule base des résultats du Service, notamment dans un contexte contractuel, réglementaire ou de conformité.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 6 — Propriété intellectuelle</h2>
            <p>
              L&apos;utilisateur conserve la pleine propriété de ses fichiers et données. FloorScan SAS conserve la propriété intellectuelle de l&apos;ensemble de la plateforme, de ses interfaces, algorithmes et marques.
            </p>
            <p className="mt-3">
              Il est interdit de reproduire, copier, vendre, revendre ou exploiter à des fins commerciales tout ou partie du Service sans autorisation expresse écrite de FloorScan SAS.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 7 — Disponibilité du Service</h2>
            <p>
              FloorScan SAS s&apos;efforce d&apos;assurer la disponibilité du Service 24h/24 et 7j/7, mais ne peut garantir une disponibilité sans interruption. Des opérations de maintenance peuvent occasionner des interruptions temporaires, communiquées autant que possible en avance.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 8 — Tarification et paiement</h2>
            <p>
              Les conditions tarifaires sont décrites sur la page <a href="/pricing" className="text-brand-400 hover:text-brand-300 transition-colors">/pricing</a>. En cas d&apos;abonnement payant, les paiements sont traités par Stripe. FloorScan SAS se réserve le droit de modifier les tarifs avec un préavis de 30 jours.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 9 — Résiliation</h2>
            <p>
              L&apos;utilisateur peut résilier son compte à tout moment depuis les paramètres de son compte ou en contactant <a href="mailto:contact@floorscan.ai" className="text-brand-400 hover:text-brand-300 transition-colors">contact@floorscan.ai</a>. Les données sont supprimées dans un délai de 30 jours suivant la demande, sauf obligation légale de conservation.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 10 — Droit applicable et litiges</h2>
            <p>
              Les présentes CGU sont soumises au droit français. En cas de litige, une solution amiable sera recherchée en priorité. À défaut, les tribunaux compétents du ressort du siège social de FloorScan SAS seront saisis.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 11 — Modifications des CGU</h2>
            <p>
              FloorScan SAS se réserve le droit de modifier les présentes CGU à tout moment. Les utilisateurs seront notifiés par e-mail ou par un bandeau d&apos;information sur la plateforme. La poursuite de l&apos;utilisation du Service vaut acceptation des nouvelles CGU.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Article 12 — Contact</h2>
            <p>
              Pour toute question relative aux présentes CGU :<br />
              <a href="mailto:contact@floorscan.ai" className="text-brand-400 hover:text-brand-300 transition-colors">contact@floorscan.ai</a>
            </p>
          </section>

          <div className="border-t border-slate-800 pt-8 text-slate-600 text-xs">
            FloorScan SAS — CGU v1.0 — Janvier 2025
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}
