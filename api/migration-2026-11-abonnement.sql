-- Migration : abonnement Topograph Pro (9.– par mois ou 84.– par an, 7 jours d'essai). MariaDB 10.4+, utf8mb4.
-- À appliquer une fois, AVANT de déployer le nouveau code de api/ (phpMyAdmin → base → SQL, ou mysql < ce fichier).
-- Sans risque si rejouée (IF NOT EXISTS).

-- client Stripe du compte (portail client, nouvel abonnement)
ALTER TABLE comptes
  ADD COLUMN IF NOT EXISTS stripe_customer VARCHAR(255) NULL,
  ADD INDEX IF NOT EXISTS stripe_customer_idx (stripe_customer);

-- Abonnements : une ligne par abonnement Stripe, tenue à jour par le webhook.
-- Le statut Pro vaut : comptes.pro = 1 (Pro offert par un administrateur) OU un abonnement trialing / active,
-- ou past_due depuis moins de 7 jours.
CREATE TABLE IF NOT EXISTS abonnements (
  id               VARCHAR(255) NOT NULL PRIMARY KEY,      -- sub_…
  compte_id        INT UNSIGNED NOT NULL,
  stripe_customer  VARCHAR(255) NOT NULL,                  -- cus_…
  statut           VARCHAR(24) NOT NULL,                   -- trialing, active, past_due, canceled, unpaid, incomplete…
  intervalle       VARCHAR(8) NULL,                        -- month, year
  montant          INT UNSIGNED NULL,                      -- centimes par période
  devise           CHAR(3) NULL,
  periode_fin      DATETIME NULL,                          -- fin de la période en cours (UTC)
  essai_fin        DATETIME NULL,                          -- fin de l'essai gratuit (UTC)
  resilie          TINYINT(1) NOT NULL DEFAULT 0,          -- résiliation programmée en fin de période
  impaye_depuis    DATETIME NULL,                          -- premier paiement refusé (grâce de 7 jours)
  cgv_version      VARCHAR(20) NULL,
  langue           CHAR(2) NULL,
  bienvenue_le     DATETIME NULL,                          -- e-mails envoyés une seule fois
  rappel_essai_le  DATETIME NULL,
  evenement_le     INT UNSIGNED NOT NULL DEFAULT 0,        -- horodatage Stripe du dernier état enregistré
  cree_le          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  maj_le           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY compte_idx (compte_id),
  KEY customer_idx (stripe_customer),
  CONSTRAINT abonnements_compte FOREIGN KEY (compte_id) REFERENCES comptes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
