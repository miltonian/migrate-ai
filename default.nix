{ pkgs ? import <nixpkgs> {} }:

pkgs.stdenv.mkDerivation {
  pname = "celp-cli";
  version = "1.0.2";

  src = pkgs.fetchFromGitHub {
    owner = "miltonian";
    repo = "celp-cli";
    rev = "v1.0.2"; 
    sha256 = "1p9mb57lgpz1h1qv5ppddm3h154ic588n13kbki1pxl0r5fszhvp";
  };

  nativeBuildInputs = [ pkgs.nodejs ];

  buildPhase = ''
    mkdir -p $out/bin
    cp -r * $out/bin/
    chmod +x $out/bin/celp-cli
  '';

  meta = {
    description = "CLI tool for generating unit tests";
    homepage = "https://github.com/miltonian/celp-cli";
    license = pkgs.lib.licenses.mit;
    maintainers = with pkgs.lib.maintainers; [ your-github-username ];
  };
}
