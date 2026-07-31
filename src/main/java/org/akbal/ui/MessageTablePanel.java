package org.akbal.ui;

import org.akbal.model.MqMessage;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import javax.swing.table.AbstractTableModel;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.table.JTableHeader;
import javax.swing.table.TableCellRenderer;
import java.awt.*;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

import static org.akbal.i18n.LocaleManager.msg;
import static org.akbal.ui.UIConstants.*;

public class MessageTablePanel extends JPanel {

    private static final DateTimeFormatter DT_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final MessageTableModel tableModel = new MessageTableModel();
    private final JTable table;

    public MessageTablePanel() {
        setLayout(new BorderLayout(0, 0));
        setOpaque(false);
        setBorder(new EmptyBorder(0, 0, 0, 0));

        // ── Section header ──────────────────────────────────────────────────
        JPanel header = createSectionHeader("📨", msg("msg.section_title"));
        header.setBorder(new EmptyBorder(8, 12, 4, 12));

        // ── Table ───────────────────────────────────────────────────────────
        table = new JTable(tableModel);
        table.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        table.setAutoResizeMode(JTable.AUTO_RESIZE_LAST_COLUMN);
        table.setRowHeight(TABLE_ROW_HEIGHT);
        table.setFont(FONT_BODY);
        table.setForeground(TEXT_PRIMARY);
        table.setGridColor(BORDER_SUBTLE);
        table.setShowHorizontalLines(true);
        table.setShowVerticalLines(false);
        table.setIntercellSpacing(new Dimension(0, 1));
        table.setFillsViewportHeight(true);
        table.setBackground(TABLE_ROW_EVEN);
        table.setSelectionBackground(TABLE_SELECTION_BG);
        table.setSelectionForeground(TABLE_SELECTION_FG);

        // Column widths
        table.getColumnModel().getColumn(0).setPreferredWidth(50);
        table.getColumnModel().getColumn(0).setMaxWidth(60);
        table.getColumnModel().getColumn(1).setPreferredWidth(220);
        table.getColumnModel().getColumn(2).setPreferredWidth(150);
        table.getColumnModel().getColumn(3).setPreferredWidth(90);
        table.getColumnModel().getColumn(4).setPreferredWidth(80);

        // ── Custom cell renderer (alternating rows + padding) ───────────────
        DefaultTableCellRenderer cellRenderer = new DefaultTableCellRenderer() {
            @Override
            public Component getTableCellRendererComponent(JTable t, Object value,
                    boolean isSelected, boolean hasFocus, int row, int column) {
                super.getTableCellRendererComponent(t, value, isSelected, hasFocus, row, column);
                setBorder(new EmptyBorder(0, 10, 0, 10));
                setFont(FONT_BODY);

                if (isSelected) {
                    setBackground(new Color(ACCENT.getRed(), ACCENT.getGreen(), ACCENT.getBlue(), 50));
                    setForeground(TABLE_SELECTION_FG);
                } else {
                    setBackground(row % 2 == 0 ? TABLE_ROW_EVEN : TABLE_ROW_ODD);
                    setForeground(TEXT_PRIMARY);
                }
                return this;
            }
        };

        for (int i = 0; i < table.getColumnCount(); i++) {
            table.getColumnModel().getColumn(i).setCellRenderer(cellRenderer);
        }

        // ── Custom header renderer ──────────────────────────────────────────
        JTableHeader tableHeader = table.getTableHeader();
        tableHeader.setFont(FONT_BODY_BOLD);
        tableHeader.setBackground(TABLE_HEADER_BG);
        tableHeader.setForeground(TEXT_SECONDARY);
        tableHeader.setPreferredSize(new Dimension(tableHeader.getPreferredSize().width, 38));
        tableHeader.setDefaultRenderer(new TableCellRenderer() {
            private final DefaultTableCellRenderer delegate = new DefaultTableCellRenderer();

            @Override
            public Component getTableCellRendererComponent(JTable t, Object value,
                    boolean isSelected, boolean hasFocus, int row, int column) {
                JLabel lbl = (JLabel) delegate.getTableCellRendererComponent(t, value, isSelected, hasFocus, row,
                        column);
                lbl.setFont(FONT_BODY_BOLD);
                lbl.setForeground(ACCENT);
                lbl.setBackground(TABLE_HEADER_BG);
                lbl.setBorder(BorderFactory.createCompoundBorder(
                        BorderFactory.createMatteBorder(0, 0, 2, 0, ACCENT_DIM),
                        new EmptyBorder(0, 10, 0, 10)));
                lbl.setHorizontalAlignment(SwingConstants.LEFT);
                lbl.setOpaque(true);
                return lbl;
            }
        });

        // ── Scroll pane ─────────────────────────────────────────────────────
        JScrollPane scrollPane = new JScrollPane(table);
        scrollPane.setBorder(BorderFactory.createLineBorder(BORDER_SUBTLE));
        scrollPane.getViewport().setBackground(TABLE_ROW_EVEN);

        add(header, BorderLayout.NORTH);
        add(scrollPane, BorderLayout.CENTER);
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

        private final String[] COLUMNS = {
                msg("msg.col.index"),
                msg("msg.col.message_id"),
                msg("msg.col.put_date"),
                msg("msg.col.format"),
                msg("msg.col.size")
        };
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
