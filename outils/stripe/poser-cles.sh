#!/bin/zsh
# Saisie des clés Stripe (rien ne s'affiche en tapant) puis envoi direct sur le serveur, par l'entrée standard de ssh.
D="cd656t_deploy@cd656t.ftp.infomaniak.com"; K=~/.ssh/topograph_deploiement
echo "Clés Stripe pour topograph.ch (dashboard.stripe.com > Développeurs > Clés API, et Webhooks > topograph-achats)."
read -rs "SK?Clé secrète (sk_test_…), ou Entrée pour la laisser telle quelle : "; echo
read -rs "WH?Secret du webhook (whsec_…), ou Entrée pour plus tard : "; echo
scp -q -i $K -o BatchMode=yes "${0:A:h}/poser-cles.php" $D:poser-cles-tmp.php || { echo "Envoi impossible."; exit 1; }
printf '%s\n%s\n' "$SK" "$WH" | ssh -i $K -o BatchMode=yes $D 'php poser-cles-tmp.php; rm -f poser-cles-tmp.php' 2>&1 | grep -v '^\*\*'
unset SK WH
