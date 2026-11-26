"""Archive ZIP lue à distance par requêtes HTTP partielles (Range) : on n'en télécharge que les membres voulus.
   python3 outils/ponts/zip_distant.py <url> [motif]   → liste des membres (taille compressée / décompressée)"""
import io, sys, urllib.request, zipfile


class FichierHttp(io.RawIOBase):
    """Fichier en lecture seule dont chaque lecture est une requête HTTP Range (avec un petit tampon)."""
    def __init__(self, url, bloc=1 << 20):
        self.url, self.pos, self.bloc, self.tampon, self.debut_tampon = url, 0, bloc, b"", -1
        r = urllib.request.urlopen(urllib.request.Request(url, method="HEAD"))
        self.taille = int(r.headers["Content-Length"])
        self.lus = 0

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.taille + off
        return self.pos

    def _plage(self, a, b):
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={a}-{b - 1}"})
        for essai in range(5):
            try:
                d = urllib.request.urlopen(req, timeout=120).read()
                self.lus += len(d)
                return d
            except Exception:
                if essai == 4: raise

    def read(self, n=-1):
        if n is None or n < 0: n = self.taille - self.pos
        n = min(n, self.taille - self.pos)
        if n <= 0: return b""
        # dans le tampon ?
        if self.debut_tampon <= self.pos and self.pos + n <= self.debut_tampon + len(self.tampon):
            k = self.pos - self.debut_tampon
            d = self.tampon[k:k + n]
        else:
            lg = max(n, self.bloc)
            self.tampon = self._plage(self.pos, min(self.taille, self.pos + lg))
            self.debut_tampon = self.pos
            d = self.tampon[:n]
        self.pos += len(d)
        return d

    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)


if __name__ == "__main__":
    z = zipfile.ZipFile(FichierHttp(sys.argv[1]))
    motif = sys.argv[2].lower() if len(sys.argv) > 2 else ""
    for i in z.infolist():
        if motif in i.filename.lower(): print(f"{i.compress_size / 1e6:9.1f} Mo  {i.file_size / 1e6:9.1f} Mo  {i.filename}")
