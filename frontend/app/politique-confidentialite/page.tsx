import type { Metadata } from "next";
import Navbar from "@/components/landing/navbar";
import Footer from "@/components/landing/footer";

export const metadata: Metadata = {
  title: "Politique de confidentialité — FloorScan",
  description: "Politique de confidentialité et protection des données personnelles de FloorScan.",
};

export default function PolitiqueConfidentialitePage() {
  return (
    <main className="overflow-x-hidden bg-[#080c18] min-h-screen">
      <Navbar />
      <div className="max-w-3xl mx-auto px-6 pt-32 pb-24">
        <h1 className="font-display text-3xl md:text-4xl font-800 text-white mb-2">Politique de confidentialité</h1>
        <p className="text-slate-500 text-sm mb-12">Dernière mise à jour : janvier 2025 — Conforme RGPD (UE 2016/679)</p>

        <div className="space-y-10 text-slate-300 text-sm leading-relaxed">

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">1. Responsable du traitement</h2>
            <p>
              Le responsable du traitement des données est <strong className="text-white">FloorScan SAS</strong>, joignable à l&apos;adresse <a href="mailto:contact@floorscan.ai" className="text-brand-400 hover:text-brand-300 transition-colors">contact@floorscan.ai</a>.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">2. Données collectées</h2>
            <p>FloorScan collecte les données suivantes :</p>
            <div className="mt-4 space-y-4">
              {[
                {
                  title: "Données de compte",
                  desc: "Adresse e-mail, nom d'affichage, mot de passe haché. Collectées lors de l'inscription.",
                  base: "Exécution du contrat",
                },
                {
                  title: "Plans architecturaux uploadés",
                  desc: "Images et fichiers PDF de plans de sol soumis à l'analyse. Ces fichiers sont traités en mémoire vive, ne sont pas conservés sur nos serveurs au-delà de la durée de la session (TTL 1h), et ne sont jamais partagés avec des tiers.",
                  base: "Exécution du contrat",
                },
                {
                  title: "Données d'utilisation",
                  desc: "Pages visitées, actions effectuées dans l'application, logs d'erreurs. Utilisées pour améliorer le service.",
                  base: "Intérêt légitime",
                },
                {
                  title: "Données de facturation",
                  desc: "En cas d'abonnement payant, les données de paiement sont traitées directement par notre prestataire (Stripe). FloorScan ne stocke jamais de numéro de carte bancaire.",
                  base: "Exécution du contrat",
                },
              ].map((item) => (
                <div key={item.title} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <span className="text-white font-medium">{item.title}</span>
                    <span className="text-xs bg-brand-950/60 text-brand-400 border border-brand-800/50 rounded-full px-2 py-0.5 shrink-0">{item.base}</span>
                  </div>
                  <p className="text-slate-400 text-xs leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">3. Durées de conservation</h2>
            <div className="mt-2 space-y-2">
              {[
                ["Données de compte", "Durée de l'abonnement + 3 ans après résiliation"],
                ["Plans architecturaux", "Session active uniquement (TTL 1h, suppression automatique)"],
                ["Projets chantier / métré", "Conservés en base de données jusqu'à suppression par l'utilisateur"],
                ["Logs techniques", "90 jours glissants"],
                ["Données de facturation", "10 ans (obligation légale comptable)"],
              ].map(([type, duree]) => (
                <div key={type as string} className="flex gap-4 py-2 border-b border-slate-800/60">
                  <span className="text-slate-300 font-medium w-52 shrink-0">{type}</span>
                  <span className="text-slate-400">{duree}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">4. Sous-traitants et transferts</h2>
            <p>FloorScan fait appel aux sous-traitants suivants :</p>
            <div className="mt-4 space-y-2">
              {[
                ["Vercel Inc.", "Hébergement de l'application", "États-Unis (clause contractuelle type UE)"],
                ["Neon Tech Inc.", "Base de données PostgreSQL", "États-Unis (clause contractuelle type UE)"],
                ["Roboflow Inc.", "Inférence IA (modèles de détection)", "États-Unis — aucune donnée personnelle transmise"],
                ["Stripe Inc.", "Traitement des paiements", "États-Unis (certifié PCI-DSS)"],
              ].map(([name, role, loc]) => (
                <div key={name as string} className="flex gap-4 py-2 border-b border-slate-800/60 text-xs">
                  <span className="text-white font-medium w-32 shrink-0">{name}</span>
                  <span className="text-slate-400 flex-1">{role}</span>
                  <span className="text-slate-500 text-right shrink-0">{loc}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-slate-400 text-xs">
              Aucune donnée personnelle n&apos;est vendue à des tiers. Les plans architecturaux uploadés ne sont jamais transmis à des services d&apos;IA cloud en dehors du traitement de la session en cours.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">5. Vos droits</h2>
            <p>Conformément au RGPD, vous disposez des droits suivants :</p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                ["Accès", "Obtenir une copie de vos données"],
                ["Rectification", "Corriger des données inexactes"],
                ["Suppression", "Demander l'effacement de vos données"],
                ["Portabilité", "Recevoir vos données en format structuré"],
                ["Opposition", "Vous opposer à certains traitements"],
                ["Limitation", "Restreindre un traitement en cours"],
              ].map(([droit, desc]) => (
                <div key={droit as string} className="bg-slate-900/40 border border-slate-800 rounded-lg p-3">
                  <span className="text-white font-medium text-xs block mb-1">Droit d&apos;{droit}</span>
                  <span className="text-slate-400 text-xs">{desc}</span>
                </div>
              ))}
            </div>
            <p className="mt-4">
              Pour exercer vos droits : <a href="mailto:contact@floorscan.ai" className="text-brand-400 hover:text-brand-300 transition-colors">contact@floorscan.ai</a>. Délai de réponse : 30 jours.
            </p>
            <p className="mt-3">
              En cas de litige, vous pouvez saisir la <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300 transition-colors">CNIL</a> (Commission Nationale de l&apos;Informatique et des Libertés).
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">6. Sécurité</h2>
            <p>
              FloorScan met en œuvre des mesures techniques et organisationnelles adaptées pour protéger vos données : chiffrement TLS en transit, hachage des mots de passe (bcrypt), accès restreints aux données, TTL automatique sur les sessions d&apos;analyse, isolation des projets par utilisateur.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">7. Cookies</h2>
            <p>
              Le site utilise uniquement des cookies fonctionnels strictement nécessaires (session d&apos;authentification, préférence de langue, thème). Aucun cookie publicitaire ou de tracking n&apos;est déposé.
            </p>
          </section>

          <section>
            <h2 className="text-white font-display font-700 text-lg mb-3 border-l-4 border-brand-500 pl-4">8. Contact DPO</h2>
            <p>
              Pour toute question relative à la protection de vos données personnelles :<br />
              <a href="mailto:contact@floorscan.ai" className="text-brand-400 hover:text-brand-300 transition-colors">contact@floorscan.ai</a>
            </p>
          </section>

          <div className="border-t border-slate-800 pt-8 text-slate-600 text-xs">
            FloorScan SAS — Politique de confidentialité v1.0 — Janvier 2025
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}
