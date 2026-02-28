# Base NixOS module shared by AWS and Hetzner cloud images.
#
# Provides: openclaw-gateway (via nix-openclaw), Docker, Tailscale,
# cloud-init, Node.js 22, and common dev tools.  All provisioning is
# baked into the image — cloud-init only writes config and restarts services.
{ config, pkgs, lib, ... }:

{
  # ---------- openclaw-gateway via nix-openclaw module ----------
  services.openclaw-gateway.enable = true;

  # ---------- Docker (for sandbox containers) ----------
  virtualisation.docker.enable = true;

  # ---------- Tailscale ----------
  services.tailscale.enable = true;

  # ---------- Cloud-init (first-boot config injection) ----------
  services.cloud-init.enable = true;

  # ---------- System packages ----------
  environment.systemPackages = with pkgs; [
    git
    curl
    gh
    nodejs_22
    pnpm_10
    gnugrep
    gnused
    gzip
    gnutar
    findutils
    cacert
  ];

  # ---------- openclaw user (uid 1000, Docker group) ----------
  users.users.openclaw = {
    isNormalUser = true;
    uid = 1000;
    home = "/home/openclaw";
    shell = pkgs.bash;
    extraGroups = [ "docker" ];
  };

  # ---------- Firewall ----------
  # Allow SSH only; gateway binds to localhost and is accessed via Tailscale.
  networking.firewall = {
    enable = true;
    allowedTCPPorts = [ 22 ];
  };

  # ---------- OpenSSH ----------
  services.openssh = {
    enable = true;
    settings = {
      PermitRootLogin = "prohibit-password";
      PasswordAuthentication = false;
    };
  };

  # ---------- Misc ----------
  time.timeZone = "UTC";
  system.stateVersion = "24.11";
}
