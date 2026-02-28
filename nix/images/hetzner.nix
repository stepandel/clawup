# Hetzner Cloud image configuration for clawup NixOS agents.
#
# Build:
#   nix build .#nixosConfigurations.clawup-agent-hetzner.config.system.build.qcow2
#
# The qcow2 output can be uploaded to Hetzner as a custom snapshot.
{ config, pkgs, lib, modulesPath, ... }:

{
  imports = [
    (modulesPath + "/profiles/qemu-guest.nix")
    ../modules/clawup-agent.nix
  ];

  # Hetzner uses virtio block devices
  boot.initrd.availableKernelModules = [ "virtio_pci" "virtio_blk" "virtio_scsi" "virtio_net" ];

  fileSystems."/" = {
    device = "/dev/sda1";
    fsType = "ext4";
    autoResize = true;
  };

  boot.loader.grub = {
    enable = true;
    device = "/dev/sda";
  };

  # Cloud-init handles network configuration on Hetzner
  networking.useDHCP = true;
}
