# AWS AMI image configuration for clawup NixOS agents.
#
# Build:
#   nix build .#nixosConfigurations.clawup-agent-aws.config.system.build.amazonImage
#
# The output is an AMI-compatible VHD that can be imported via
# `aws ec2 import-image` or registered as a snapshot-backed AMI.
{ config, pkgs, lib, modulesPath, ... }:

{
  imports = [
    (modulesPath + "/virtualisation/amazon-image.nix")
    ../modules/clawup-agent.nix
  ];

  # EC2-specific settings
  ec2.hvm = true;
  ec2.efi = true;

  # gp3 root volume (matching existing Ubuntu 24.04 setup)
  fileSystems."/" = lib.mkForce {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
    autoResize = true;
  };
}
