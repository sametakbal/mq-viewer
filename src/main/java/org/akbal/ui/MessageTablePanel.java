package org.akbal.ui;

import org.akbal.model.MqMessage;

import javax.swing.*;
import javax.swing.table.AbstractTableModel;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

public class MessageTablePanel extends JPanel {

    private static final DateTimeFormatter DT_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final MessageTableModel tableModel = new MessageTableModel();
    private final JTable table;

    public MessageTablePanel() {
        setLayout(new java.awt.BorderLayout());
        setBorder(BorderFactory.createTitledBorder("Mesajlar"));

        table = new JTable(tableModel);
        table.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        table.setAutoResizeMode(JTable.AUTO_RESIZE_LAST_COLUMN);
        table.getColumnModel().getColumn(0).setPreferredWidth(40);
        table.getColumnModel().getColumn(1).setPreferredWidth(200);
        table.getColumnModel().getColumn(2).setPreferredWidth(140);
        table.getColumnModel().getColumn(3).setPreferredWidth(80);
        table.getColumnModel().getColumn(4).setPreferredWidth(70);

        add(new JScrollPane(table), java.awt.BorderLayout.CENTER);
    }

    public void setMessages(List<MqMessage> messages) {
        tableModel.setMessages(messages);
    }

    public void clearMessages() {
        tableModel.setMessages(new ArrayList<>());
    }

    public JTable getTable() {
        return table;
    }

    public MqMessage getSelectedMessage() {
        int row = table.getSelectedRow();
        if (row >= 0) {
            return tableModel.getMessageAt(row);
        }
        return null;
    }

    private class MessageTableModel extends AbstractTableModel {

        private final String[] COLUMNS = { "#", "Message ID", "Put Tarih", "Format", "Boyut" };
        private List<MqMessage> messages = new ArrayList<>();

        public void setMessages(List<MqMessage> messages) {
            this.messages = messages;
            fireTableDataChanged();
        }

        public MqMessage getMessageAt(int row) {
            return messages.get(row);
        }

        @Override
        public int getRowCount() {
            return messages.size();
        }

        @Override
        public int getColumnCount() {
            return COLUMNS.length;
        }

        @Override
        public String getColumnName(int column) {
            return COLUMNS[column];
        }

        @Override
        public Object getValueAt(int rowIndex, int columnIndex) {
            MqMessage msg = messages.get(rowIndex);
            return switch (columnIndex) {
                case 0 -> msg.getIndex();
                case 1 -> msg.getMessageId();
                case 2 -> msg.getPutDateTime() != null ? msg.getPutDateTime().format(DT_FMT) : "";
                case 3 -> msg.getFormat();
                case 4 -> msg.getSize() + " B";
                default -> "";
            };
        }
    }
}
