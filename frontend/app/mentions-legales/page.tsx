import type { Metadata } from "next";
import Navbar from "@/components/landing/navbar";
import Footer from "@/components/landing/footer";

export const metadata: Metadata = {
  title: "Mentions légales — FloorScan",
  description: "Mentions légales de FloorScan, éditeur du service d'analyse de plans architecturaux par IA.",
};

export default function MentionsLegalesPage() {
  return (
    <main className="overflow-x-hidden bg-[#080c18] min-h-screen">
      <Navbar />
      <div className="max-w-3xl mx-auto px-6 pt-32 pb-24">
        <h1 className="font-display text-3xl md:text-4xl font-800 text-white mb-2">Mentions légales</h1>
        <p className="text-slate-500 text-sm mb-12">Dernière mise à jour : janvier 2025</p>

        <div className="space-y-10 text-slate-300 text-sm leading-relaxed">

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Éditeur du site</h2>
            <p>Le site <strong className="text-white">floorscan.ai</strong> est édité par :</p>
            <ul className="mt-3 space-y-1 text-slate-400">
              <li><span className="text-slate-300 font-medium">Raison sociale :</span> FloorScan SAS</li>
              <li><span className="text-slate-300 font-medium">Forme juridique :</span> Société par Actions Simplifiée (SAS)</li>
              <li><span className="text-slate-300 font-medium">Capital social :</span> En cours de constitution</li>
              <li><span className="text-slate-300 font-medium">Siège social :</span> France</li>
              <li><span className="text-slate-300 font-medium">Email :</span> <a href="mailto:contact@floorscan.ai" className="text-brand-400 hover:text-brand-300 transition-colors">contact@floorscan.ai</a></li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Directeur de la publication</h2>
            <p>Le directeur de la publication est le représentant légal de la société FloorScan SAS.</p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Hébergement</h2>
            <p>Le site est hébergé par :</p>
            <ul className="mt-3 space-y-1 text-slate-400">
              <li><span className="text-slate-300 font-medium">Prestataire :</span> Vercel Inc.</li>
              <li><span className="text-slate-300 font-medium">Adresse :</span> 340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis</li>
              <li><span className="text-slate-300 font-medium">Site :</span> <a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300 transition-colors">vercel.com</a></li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Propriété intellectuelle</h2>
            <p>
              L&apos;ensemble du contenu présent sur le site floorscan.ai (textes, images, logos, interface, code source, algorithmes d&apos;analyse par intelligence artificielle) est la propriété exclusive de FloorScan SAS ou de ses partenaires, et est protégé par le droit français et international de la propriété intellectuelle.
            </p>
            <p className="mt-3">
              Toute reproduction, représentation, modification, publication ou adaptation de tout ou partie des éléments du site, quel que soit le moyen ou le procédé utilisé, est interdite sans l&apos;autorisation préalable et écrite de FloorScan SAS.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Données personnelles</h2>
            <p>
              FloorScan SAS traite vos données personnelles conformément au Règlement Général sur la Protection des Données (RGPD – Règlement UE 2016/679) et à la loi Informatique et Libertés modifiée.
            </p>
            <p className="mt-3">
              Pour plus d&apos;informations, consultez notre <a href="/politique-confidentialite" className="text-brand-400 hover:text-brand-300 transition-colors">Politique de confidentialité</a>.
            </p>
            <p className="mt-3">
              Pour exercer vos droits (accès, rectification, suppression, portabilité, opposition), contactez-nous à : <a href="mailto:contact@floorscan.ai" className="text-brand-400 hover:text-brand-300 transition-colors">contact@floorscan.ai</a>
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Cookies</h2>
            <p>
              Le site utilise des cookies techniques nécessaires au fonctionnement du service (authentification, préférences de langue). Aucun cookie publicitaire ou de tracking tiers n&apos;est utilisé sans votre consentement explicite.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Limitation de responsabilité</h2>
            <p>
              Les analyses générées par FloorScan sont produites par des algorithmes d&apos;intelligence artificielle à titre indicatif. FloorScan SAS ne saurait être tenu responsable des décisions prises sur la base de ces analyses. Les résultats doivent être vérifiés par un professionnel qualifié avant toute utilisation dans un contexte contractuel ou réglementaire.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">Droit applicable</h2>
            <p>
              Les présentes mentions légales sont soumises au droit français. En cas de litige, les tribunaux français seront compétents.
            </p>
          </section>

          <div className="border-t border-slate-800 pt-8 text-slate-600 text-xs">
            Pour toute question : <a href="mailto:contact@floorscan.ai" className="text-slate-400 hover:text-brand-400 transition-colors">contact@floorscan.ai</a>
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}
