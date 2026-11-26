-- Comptes « Ombres » — MySQL 8 / MariaDB 10.4+, utf8mb4.
-- Import : phpMyAdmin (Manager Infomaniak) → base → Importer, ou mysql < schema.sql

CREATE TABLE IF NOT EXISTS comptes (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(254) NOT NULL,
  pro        TINYINT(1) NOT NULL DEFAULT 0,
  achete_le  DATETIME NULL,
  cree_le    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
