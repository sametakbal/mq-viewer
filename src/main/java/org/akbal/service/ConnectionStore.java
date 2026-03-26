package org.akbal.service;

import org.akbal.model.MqConnectionConfig;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class ConnectionStore {

    private static final String STORE_DIR = System.getProperty("user.home") + File.separator + ".mq-viewer";
    private static final String STORE_FILE = STORE_DIR + File.separator + "connections.properties";

    public List<MqConnectionConfig> loadAll() {
        List<MqConnectionConfig> list = new ArrayList<>();
        Path path = Path.of(STORE_FILE);
        if (!Files.exists(path)) {
            return list;
        }

        try {
            List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
            Map<Integer, MqConnectionConfig> map = new TreeMap<>();

            for (String line : lines) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#"))
                    continue;

                int eq = line.indexOf('=');
                if (eq <= 0)
                    continue;

                String key = line.substring(0, eq).trim();
                String value = line.substring(eq + 1).trim();

                // key format: connection.0.host
                String[] parts = key.split("\\.");
                if (parts.length != 3 || !"connection".equals(parts[0]))
                    continue;

                int index;
                try {
                    index = Integer.parseInt(parts[1]);
                } catch (NumberFormatException e) {
                    continue;
                }

                MqConnectionConfig config = map.computeIfAbsent(index, k -> new MqConnectionConfig());
                switch (parts[2]) {
                    case "name" -> config.setName(value);
                    case "host" -> config.setHost(value);
                    case "port" -> {
                        try {
                            config.setPort(Integer.parseInt(value));
                        } catch (NumberFormatException ignored) {
                        }
                    }
                    case "channel" -> config.setChannel(value);
                    case "queueManager" -> config.setQueueManager(value);
                    case "queueName" -> config.setQueueName(value);
                    case "username" -> config.setUsername(value);
                    case "password" -> config.setPassword(decodePassword(value));
                }
            }

            list.addAll(map.values());
        } catch (IOException e) {
            e.printStackTrace();
        }

        return list;
    }

    public void saveAll(List<MqConnectionConfig> connections) {
        try {
            Files.createDirectories(Path.of(STORE_DIR));

            StringBuilder sb = new StringBuilder();
            sb.append("# MQ Viewer - Kayıtlı Bağlantılar\n\n");

            for (int i = 0; i < connections.size(); i++) {
                MqConnectionConfig c = connections.get(i);
                String prefix = "connection." + i + ".";
                sb.append(prefix).append("name=").append(c.getName()).append("\n");
                sb.append(prefix).append("host=").append(c.getHost()).append("\n");
                sb.append(prefix).append("port=").append(c.getPort()).append("\n");
                sb.append(prefix).append("channel=").append(c.getChannel()).append("\n");
                sb.append(prefix).append("queueManager=").append(c.getQueueManager()).append("\n");
                sb.append(prefix).append("queueName=").append(c.getQueueName()).append("\n");
                sb.append(prefix).append("username=").append(c.getUsername()).append("\n");
                sb.append(prefix).append("password=").append(encodePassword(c.getPassword())).append("\n");
                sb.append("\n");
            }

            Files.writeString(Path.of(STORE_FILE), sb.toString(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public void addOrUpdate(MqConnectionConfig config) {
        List<MqConnectionConfig> all = loadAll();
        boolean found = false;
        for (int i = 0; i < all.size(); i++) {
            if (all.get(i).getName().equals(config.getName())) {
                all.set(i, config);
                found = true;
                break;
            }
        }
        if (!found) {
            all.add(config);
        }
        saveAll(all);
    }

    public void delete(String name) {
        List<MqConnectionConfig> all = loadAll();
        all.removeIf(c -> c.getName().equals(name));
        saveAll(all);
    }

    private String encodePassword(String password) {
        if (password == null || password.isEmpty())
            return "";
        return Base64.getEncoder().encodeToString(password.getBytes(StandardCharsets.UTF_8));
    }

    private String decodePassword(String encoded) {
        if (encoded == null || encoded.isEmpty())
            return "";
        try {
            return new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return encoded;
        }
    }
}
