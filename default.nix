{ pkgs ? import <nixpkgs> {} }:

pkgs.stdenv.mkDerivation {
  pname = "migrate-ai";
  version = "1.0.2";

  src = pkgs.fetchFromGitHub {
    owner = "miltonian";
    repo = "migrate-ai";
    rev = "v1.0.2"; 
    sha256 = "1p9mb57lgpz1h1qv5ppddm3h154ic588n13kbki1pxl0r5fszhvp";
  };

  nativeBuildInputs = [ pkgs.nodejs ];

  buildPhase = ''
    mkdir -p $out/bin
    cp -r * $out/bin/
    chmod +x $out/bin/migrate-ai
  '';

  meta = {
    description = "CLI tool for generating unit tests";
    homepage = "https://github.com/miltonian/migrate-ai";
    license = pkgs.lib.licenses.mit;
    maintainers = with pkgs.lib.maintainers; [ your-github-username ];
  };
}
