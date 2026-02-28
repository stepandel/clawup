{ pkgs }:

let
  # openclaw-gateway is provided by the nix-openclaw overlay
  openclaw-gateway = pkgs.openclaw-gateway;

  # Combine PATH entries for the image
  pathPackages = with pkgs; [
    openclaw-gateway
    nodejs_22
    pnpm_10
    bash
    coreutils
    gnugrep
    gnused
    gzip
    gnutar
    findutils
    git
    curl
    jq
    cacert
    gh
  ];

  pathBin = pkgs.lib.makeBinPath pathPackages;
in
pkgs.dockerTools.buildLayeredImage {
  name = "clawup-openclaw";
  tag = "latest";

  contents = pathPackages;

  fakeRootCommands = ''
    # Create required directories
    mkdir -p ./home/openclaw/.openclaw/workspace
    mkdir -p ./tmp
    chmod 1777 ./tmp

    # Create passwd/group for openclaw user (uid 1000)
    mkdir -p ./etc
    echo "root:x:0:0:root:/root:/bin/bash" > ./etc/passwd
    echo "openclaw:x:1000:1000::/home/openclaw:/bin/bash" >> ./etc/passwd
    echo "root:x:0:" > ./etc/group
    echo "openclaw:x:1000:" >> ./etc/group

    # Set ownership
    chown -R 1000:1000 ./home/openclaw
  '';

  enableFakechroot = true;

  config = {
    User = "openclaw";
    WorkingDir = "/home/openclaw";
    Cmd = [ "/bin/bash" ];
    Env = [
      "HOME=/home/openclaw"
      "PATH=${pathBin}:/home/openclaw/.local/bin"
      "OPENCLAW_NIX_MODE=1"
      "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    ];
    ExposedPorts = {
      "18789/tcp" = {};
    };
  };
}
