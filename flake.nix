{
  description = "Clawup — pre-built NixOS images for OpenClaw agents (Docker, AWS, Hetzner)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nix-openclaw.url = "github:openclaw/nix-openclaw";
  };

  outputs = { self, nixpkgs, nix-openclaw }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        overlays = [ nix-openclaw.overlays.default ];
      };
    in
    {
      packages.${system}.docker-image = import ./nix/docker-image.nix {
        inherit pkgs;
      };

      # Convenience alias: `nix build .#docker-image`
      packages.${system}.default = self.packages.${system}.docker-image;

      # NixOS VM images for cloud providers
      nixosConfigurations.clawup-agent-aws = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          nix-openclaw.nixosModules.default
          ./nix/images/aws.nix
        ];
      };

      nixosConfigurations.clawup-agent-hetzner = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          nix-openclaw.nixosModules.default
          ./nix/images/hetzner.nix
        ];
      };
    };

  # Build images:
  #   Docker:  nix build .#docker-image && docker load < result
  #   AWS:     nix build .#nixosConfigurations.clawup-agent-aws.config.system.build.amazonImage
  #   Hetzner: nix build .#nixosConfigurations.clawup-agent-hetzner.config.system.build.qcow2
}
