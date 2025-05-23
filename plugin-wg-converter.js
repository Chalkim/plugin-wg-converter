const onRun = async () => {
  let dialFieldsObj = {};
  try {
    dialFieldsObj = JSON.parse(Plugin.DIAL_FIELDS);
  } catch (e) {
    const { id } = Plugins.message.info(
      "解析拨号字段失败，使用默认空对象",
      4000
    );
    await Plugins.sleep(2500);
    Plugins.message.destroy(id);
  }

  const input = await Plugins.prompt("请输入WireGuard客户端配置：", "", {
    placeholder: `[Interface]
PrivateKey = <your private key>
Address = 10.8.0.X/24
DNS = 1.1.1.1
MTU = 1420

[Peer]
PublicKey = <server public key>
PresharedKey = <optional preshared key>
AllowedIPs = 10.8.0.0/24
PersistentKeepalive = 25
Endpoint = example.com:51820`,
    type: "code",
  });

  const result = parseWireGuardConfig(input, dialFieldsObj);

  const profilesStore = Plugins.useProfilesStore()
  const appSettingsStore = Plugins.useAppSettingsStore()
  const kernelApiStore = Plugins.useKernelApiStore()
  const profiles = profilesStore.profiles
  const runtimeProfile = profilesStore.getProfileById(appSettingsStore.app.kernel.profile)

  const options = profiles.map(({ id, name }) => ({
    label: name,
    value: id,
  }));

  options.push({
    label: "复制到剪贴板",
    value: "copy_clipboard"
  });

  const selected = await Plugins.picker.single("请选择要修改的配置，或选择复制到剪贴板", options);

  if (selected === "copy_clipboard") {
    await Plugins.ClipboardSetText(result);
    Plugins.message.success('复制成功');
  } else {
      const profile = profilesStore.getProfileById(selected);
      if (!profile) {
        Plugins.message.error('未找到对应配置');
        return;
      }

      const newProfile = { ...profile, mixin: { ...profile.mixin, config: result } };

      try {
        await profilesStore.editProfile(selected, newProfile);
        Plugins.message.success('配置已更新');
        await Plugins.sleep(1000);
        if(runtimeProfile && runtimeProfile.id === selected) {
          await kernelApiStore.stopKernel()
          await kernelApiStore.startKernel(newProfile)
          Plugins.message.success('内核重启成功');
        }
      } catch (error) {
        Plugins.message.error('更新配置失败');
        console.error(error);
      }
  }

  return 0;
};

function parseWireGuardConfig(input, dialFields = {}) {
  const lines = input.split(/\r?\n/);
  const config = { Interface: {}, Peer: {} };
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("[")) {
      currentSection = trimmed.slice(1, -1);
    } else if (currentSection) {
      const index = trimmed.indexOf("=");
      if (index > -1) {
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim();
        config[currentSection][key] = value;
      }
    }
  }

  // 解析 Endpoint 地址和端口
  const [host, portStr] = config.Peer.Endpoint.split(":");

  // 构造最终 JSON 输出
  const result = {
    endpoints: [
      {
        ...dialFields,
        type: "wireguard",
        tag: "wg-ep",
        system: true,
        mtu: parseInt(config.Interface.MTU || "1408", 10),
        address: [config.Interface.Address],
        private_key: config.Interface.PrivateKey,
        peers: [
          {
            address: host,
            port: parseInt(portStr, 10),
            public_key: config.Peer.PublicKey,
            pre_shared_key: config.Peer.PresharedKey,
            allowed_ips: [config.Peer.AllowedIPs],
            persistent_keepalive_interval: parseInt(config.Peer.PersistentKeepalive) || 0,
            reserved: [0, 0, 0],
          },
        ],
      },
    ]
  };

  return JSON.stringify(result, null, 2);
}
