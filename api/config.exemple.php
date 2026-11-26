<?php
// Configuration de l'API des comptes. Copier ce fichier en config.php (ignoré par git) et remplir les valeurs.
// Ne jamais mettre de secret dans le code ni dans le dépôt.

// Base MySQL / MariaDB d'Infomaniak (Manager → Hébergement web → Bases de données)
const BD_DSN = 'mysql:host=xxxx.myd.infomaniak.com;dbname=xxxx_ombres;charset=utf8mb4';
const BD_UTILISATEUR = 'xxxx_ombres';
const BD_MOT_DE_PASSE = '';

// Stripe (Dashboard → Développeurs → Clés API). sk_test_… en test, sk_live_… en production.
const STRIPE_CLE_SECRETE = '';
// Secret de signature du point de terminaison webhook (whsec_…)
const STRIPE_SECRET_WEBHOOK = '';

// Vente unique
const PRIX_CENTIMES = 3900;            // CHF 39.–
const DEVISE = 'chf';
const NOM_PRODUIT = 'Ombres — licence pro';

// Adresse publique du site, sans barre finale (pages de retour, liens de connexion)
const SITE_URL = 'https://exemple.ch';
// Adresse de l'API (dossier api/), sans barre finale
const API_URL = 'https://exemple.ch/api';
// Origine de développement autorisée en CORS avec cookies ('' pour aucune)
const ORIGINE_DEV = 'http://localhost:5199';
// Cookie Secure : true en production ; false seulement pour un test local en http hors Chrome/Firefox
const COOKIE_SECURE = true;

// E-mail : SMTP Infomaniak (Manager → Service Mail → adresse → Configurer un client)
const SMTP_HOTE = 'mail.infomaniak.com';   // '' : repli sur mail() de PHP
const SMTP_PORT = 465;                      // SSL/TLS
const SMTP_UTILISATEUR = 'compte@exemple.ch';
const SMTP_MOT_DE_PASSE = '';
const EXPEDITEUR_EMAIL = 'compte@exemple.ch';
const EXPEDITEUR_NOM = 'Ombres — Atelier Masson';

// Limites des demandes de lien (par heure)
const LIMITE_PAR_EMAIL = 5;
const LIMITE_PAR_IP = 20;
