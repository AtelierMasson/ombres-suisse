-- Comptes « Topograph » — MySQL 8 / MariaDB 10.4+, utf8mb4.
-- Import : phpMyAdmin (Manager Infomaniak) → base → Importer, ou mysql < schema.sql

CREATE TABLE IF NOT EXISTS comptes (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(254) NOT NULL,
  pro        TINYINT(1) NOT NULL DEFAULT 0,
  achete_le  DATETIME NULL,
  cree_le    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Informations du compte (facultatives : factures, contact)
ALTER TABLE comptes
  ADD COLUMN IF NOT EXISTS prenom    VARCHAR(80)  NULL,
  ADD COLUMN IF NOT EXISTS nom       VARCHAR(80)  NULL,
  ADD COLUMN IF NOT EXISTS societe   VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS adresse   VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS npa       VARCHAR(12)  NULL,
  ADD COLUMN IF NOT EXISTS localite  VARCHAR(80)  NULL,
  ADD COLUMN IF NOT EXISTS pays      VARCHAR(60)  NULL,
  ADD COLUMN IF NOT EXISTS telephone VARCHAR(40)  NULL;

-- Liens de connexion : seul le haché SHA-256 du jeton est conservé
CREATE TABLE IF NOT EXISTS jetons (
  jeton     CHAR(64) NOT NULL PRIMARY KEY,
  email     VARCHAR(254) NOT NULL,
  expire    DATETIME NOT NULL,
  utilise   TINYINT(1) NOT NULL DEFAULT 0,
  KEY expire_idx (expire)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sessions : id = haché SHA-256 de la valeur du cookie
CREATE TABLE IF NOT EXISTS sessions (
  id         CHAR(64) NOT NULL PRIMARY KEY,
  compte_id  INT UNSIGNED NOT NULL,
  expire     DATETIME NOT NULL,
  KEY compte_idx (compte_id),
  KEY expire_idx (expire),
  CONSTRAINT sessions_compte FOREIGN KEY (compte_id) REFERENCES comptes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Achats : une ligne par session Stripe Checkout
CREATE TABLE IF NOT EXISTS achats (
  id         VARCHAR(255) NOT NULL PRIMARY KEY,   -- cs_test_… / cs_live_…
  compte_id  INT UNSIGNED NOT NULL,
  montant    INT UNSIGNED NOT NULL,               -- centimes
  devise     CHAR(3) NOT NULL,
  etat       VARCHAR(16) NOT NULL DEFAULT 'ouvert', -- ouvert, paye
  cree_le    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY compte_idx (compte_id),
  CONSTRAINT achats_compte FOREIGN KEY (compte_id) REFERENCES comptes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Limitation des demandes de lien : clé = haché de « email:… » ou « ip:… »
CREATE TABLE IF NOT EXISTS demandes (
  id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cle      CHAR(64) NOT NULL,
  cree_le  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY cle_date (cle, cree_le)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Compteurs d'usage anonymes (tableau d'administration) : un total par jour et par événement, aucune donnée personnelle
CREATE TABLE IF NOT EXISTS compteurs (
  jour       DATE NOT NULL,
  evenement  VARCHAR(32) NOT NULL,
  n          INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (jour, evenement)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lieux enregistrés par un compte : nom, lien (fragment #… de l'adresse, vue de la caméra comprise)
CREATE TABLE IF NOT EXISTS lieux (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  compte_id  INT UNSIGNED NOT NULL,
  nom        VARCHAR(160) NOT NULL,
  lien       VARCHAR(1000) NOT NULL,
  cree_le    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY compte_idx (compte_id),
  CONSTRAINT lieux_compte FOREIGN KEY (compte_id) REFERENCES comptes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
