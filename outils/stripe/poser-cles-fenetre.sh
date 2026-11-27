#!/bin/zsh
# Même chose que poser-cles.sh, avec deux petites fenêtres macOS (saisie masquée) au lieu du terminal.
D="cd656t_deploy@cd656t.ftp.infomaniak.com"; K=~/.ssh/topograph_deploiement
demande() { osascript -e "text returned of (display dialog \"$1\" default answer \"\" with hidden answer with title \"Topograph : clés Stripe\" buttons {\"Annuler\", \"OK\"} default button \"OK\" cancel button \"Annuler\")" 2>/dev/null; }
SK=$(demande "Clé secrète Stripe (sk_test_…), copiée dans Stripe > Développeurs > Clés API.\nLaisser vide pour ne pas la changer.") || { echo "Annulé."; exit 1; }
WH=$(demande "Secret du webhook (whsec_…), dans Stripe > Développeurs > Webhooks > topograph-achats > Signing secret.\nLaisser vide pour plus tard.") || { echo "Annulé."; exit 1; }
scp -q -i $K -o BatchMode=yes "${0:A:h}/poser-cles.php" $D:poser-cles-tmp.php || { echo "Envoi impossible."; exit 1; }
printf '%s\n%s\n' "$SK" "$WH" | ssh -i $K -o BatchMode=yes $D 'php poser-cles-tmp.php; rm -f poser-cles-tmp.php' 2>&1 | grep -v '^\*\*'
unset SK WH
